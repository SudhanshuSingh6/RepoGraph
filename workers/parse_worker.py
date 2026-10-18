"""Processes one claimed parse job: fetch source → build inventory → store it.

All parsed rows for the job, plus the job's own `done` transition, are written in ONE
transaction that first deletes any rows from a previous attempt. A crash mid-parse
therefore leaves nothing behind, and a retry starts from a clean slate. The final
transition is conditioned on this attempt still owning the claim, so an attempt that
was reclaimed as stale (and possibly re-run elsewhere) can't commit over the newer one.
"""

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

import psycopg

from file_storage import write_contents
from inventory import build_inventory
from source import Caps, ImportRejected, clone_github, extract_zip


@dataclass
class Job:
    id: str
    project_id: str
    attempts: int


@dataclass
class Settings:
    max_bytes: int
    max_files: int
    max_attempts: int
    stale_timeout_min: int


# Every job's working copy lives under here, so startup recovery can delete whatever a
# hard-killed run (kill -9, OOM, power loss) left behind — its `finally` never ran.
WORK_ROOT = Path(tempfile.gettempdir()) / "repograph-worker"


def sweep_work_root() -> int:
    """Deletes leftover working copies. Only safe when no other worker on this host is
    mid-job, i.e. alongside the startup reset of orphaned jobs."""
    if not WORK_ROOT.exists():
        return 0
    leftovers = list(WORK_ROOT.iterdir())
    for p in leftovers:
        shutil.rmtree(p, ignore_errors=True)
    return len(leftovers)


class LostClaim(Exception):
    """This attempt no longer owns its job (it was reclaimed as stale)."""


def set_project_status(conn: psycopg.Connection, job: "Job", status: str) -> None:
    """Progress update (cloning → parsing), only while this attempt still owns the claim —
    a reclaimed attempt waking up must not flip a finished project back to `cloning`."""
    cur = conn.execute(
        "update projects set status = %s where id = %s and exists ("
        "  select 1 from parse_jobs where id = %s and status = 'processing' and attempts = %s)",
        (status, job.project_id, job.id, job.attempts),
    )
    if cur.rowcount != 1:
        raise LostClaim(job.id)


def fetch_source(conn: psycopg.Connection, project: dict, dest: Path, settings: Settings) -> None:
    caps = Caps(settings.max_bytes, settings.max_files)
    if project["source"] == "github":
        clone_github(project["github_owner"], project["github_repo"], project["github_branch"],
                     dest, caps)
        return
    row = conn.execute("select archive from project_uploads where project_id = %s",
                       (project["id"],)).fetchone()
    if row is None:
        raise ImportRejected("The uploaded archive is missing — please upload it again.")
    extract_zip(bytes(row["archive"]), dest, caps)


def run_job(conn: psycopg.Connection, job: Job, settings: Settings) -> None:
    project = conn.execute(
        "select id, source, github_owner, github_repo, github_branch from projects where id = %s",
        (job.project_id,),
    ).fetchone()
    if project is None:
        return  # project deleted while queued; the job row cascaded with it

    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="job-", dir=WORK_ROOT))
    try:
        set_project_status(conn, job, "cloning")
        src = workdir / "src"
        src.mkdir()
        fetch_source(conn, project, src, settings)

        set_project_status(conn, job, "parsing")
        inv = build_inventory(src)
        if not inv.files and not inv.skipped_large:
            raise ImportRejected(
                "No Java, JavaScript, TypeScript or Python files were found in this project.")

        with conn.transaction():
            conn.execute("delete from parsed_files where project_id = %s", (job.project_id,))
            with conn.cursor() as cur:
                ids = []
                for f in inv.files:
                    cur.execute(
                        "insert into parsed_files (project_id, path, lang, loc, is_test) "
                        "values (%s, %s, %s, %s, %s) returning id",
                        (job.project_id, f.path, f.lang, f.loc, f.is_test),
                    )
                    ids.append(cur.fetchone()["id"])
                write_contents(cur, [(i, f.content) for i, f in zip(ids, inv.files)])
            finish(conn, job, "done", None)
            conn.execute(
                "update projects set status = 'ready', error_message = null, "
                "skipped_large_files = %s where id = %s",
                (inv.skipped_large, job.project_id),
            )
            conn.execute("delete from project_uploads where project_id = %s", (job.project_id,))
    finally:
        # Only parsed rows persist — never a lingering copy of the source on disk.
        shutil.rmtree(workdir, ignore_errors=True)


def finish(conn: psycopg.Connection, job: Job, status: str, error: str | None) -> None:
    """Moves the job out of `processing`, but only if this attempt still owns the claim."""
    cur = conn.execute(
        "update parse_jobs set status = %s, error_message = %s "
        "where id = %s and status = 'processing' and attempts = %s",
        (status, error, job.id, job.attempts),
    )
    if cur.rowcount != 1:
        raise LostClaim(job.id)


def record_failure(conn: psycopg.Connection, job: Job, error: Exception,
                   settings: Settings) -> str:
    """Retries transient failures up to max_attempts; ImportRejected is terminal at once.
    Returns the job's resulting status."""
    terminal = isinstance(error, ImportRejected) or job.attempts >= settings.max_attempts
    message = str(error) if isinstance(error, ImportRejected) else f"Import failed: {error}"
    with conn.transaction():
        if terminal:
            finish(conn, job, "failed", message)
            conn.execute("update projects set status = 'error', error_message = %s where id = %s",
                         (message, job.project_id))
            conn.execute("delete from project_uploads where project_id = %s", (job.project_id,))
            return "failed"
        finish(conn, job, "pending", message)
        conn.execute("update projects set status = 'pending' where id = %s", (job.project_id,))
        return "pending"
