"""BUILD_PLAN.md Phase 3a/3b/6 acceptance checks for the worker, against real Postgres."""

import io
import json
import zipfile
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

import parse_worker
import worker_loop
from parse_worker import Job, LostClaim, Settings, run_job

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "sample-project"
SAMPLE_EDGES = {tuple(e) for e in
                json.loads((ROOT / "tests/fixtures/sample-edges.json").read_text())["edges"]}
SETTINGS = Settings(max_bytes=50 * 1024 * 1024, max_files=1000, max_attempts=3,
                    stale_timeout_min=15)


def zip_dir(root: Path, wrapper: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(root.rglob("*")):
            if p.is_file():
                zf.write(p, f"{wrapper}/{p.relative_to(root).as_posix()}")
    return buf.getvalue()


def zip_entries(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def create_upload_project(conn, user_id, archive: bytes) -> str:
    """What POST /api/projects does for an upload: project + upload + job, one transaction."""
    with conn.transaction():
        pid = conn.execute(
            "insert into projects (owner_id, name, source) values (%s, 'p', 'upload') returning id",
            (user_id,),
        ).fetchone()["id"]
        conn.execute("insert into project_uploads (project_id, archive) values (%s, %s)",
                     (pid, archive))
        conn.execute("insert into parse_jobs (project_id) values (%s)", (pid,))
    return str(pid)


def project(conn, pid):
    return conn.execute("select * from projects where id = %s", (pid,)).fetchone()


def job_row(conn, pid):
    return conn.execute("select * from parse_jobs where project_id = %s", (pid,)).fetchone()


def file_paths(conn, pid):
    rows = conn.execute("select path from parsed_files where project_id = %s", (pid,)).fetchall()
    return sorted(r["path"] for r in rows)  # Python order; Postgres collation ignores "_"


def edge_paths(conn, pid):
    rows = conn.execute(
        "select f.path from_path, t.path to_path from parsed_edges e "
        "join parsed_files f on f.id = e.from_file_id "
        "join parsed_files t on t.id = e.to_file_id where e.project_id = %s", (pid,)).fetchall()
    return sorted((r["from_path"], r["to_path"]) for r in rows)


def type_rows(conn, pid):
    rows = conn.execute(
        "select f.path, t.name, t.kind, t.extends, t.implements from parsed_types t "
        "join parsed_files f on f.id = t.file_id where t.project_id = %s", (pid,)).fetchall()
    return sorted((r["path"].rsplit("/", 1)[1], r["name"], r["kind"], tuple(r["extends"]),
                   tuple(r["implements"])) for r in rows)


SAMPLE_TYPES = sorted([
    ("BaseJob.java", "BaseJob", "abstract", (), ()),
    ("CleanupJob.java", "CleanupJob", "class", ("BaseJob",), ()),
    ("JobsApplication.java", "JobsApplication", "class", (), ()),
    ("Order.java", "Order", "class", (), ()),
    ("ReportJob.java", "ReportJob", "class", ("BaseJob",), ()),
    ("ReportJobTest.java", "ReportJobTest", "class", (), ()),
    ("client.ts", "ApiClient", "class", (), ()),
    ("models.py", "Customer", "class", ("Base",), ()),
])


def expected_sample_paths():
    return sorted(p.relative_to(FIXTURE).as_posix() for p in FIXTURE.rglob("*")
                  if p.is_file() and p.suffix in {".ts", ".js", ".py", ".java"})


def test_upload_import_produces_inventory(conn, user_id):
    pid = create_upload_project(conn, user_id, zip_dir(FIXTURE, "sample-project-main"))
    assert worker_loop.process_one(conn, SETTINGS)

    p = project(conn, pid)
    assert p["status"] == "ready" and p["error_message"] is None
    assert job_row(conn, pid)["status"] == "done"
    assert file_paths(conn, pid) == expected_sample_paths()  # wrapper stripped, README dropped

    langs = {r["lang"]: r["n"] for r in conn.execute(
        "select lang, count(*)::int n from parsed_files where project_id = %s group by lang",
        (pid,))}
    assert langs == {"ts": 5, "js": 1, "py": 5, "java": 6}
    tests = {r["path"] for r in conn.execute(
        "select path from parsed_files where project_id = %s and is_test", (pid,))}
    assert tests == {"web/src/api/client.test.ts", "backend/tests/test_routes.py",
                     "jobs/src/test/java/com/example/jobs/ReportJobTest.java"}
    content = conn.execute(
        "select content from parsed_files where project_id = %s and path = 'backend/models.py'",
        (pid,)).fetchone()["content"]
    assert content == (FIXTURE / "backend/models.py").read_text()
    assert edge_paths(conn, pid) == sorted(SAMPLE_EDGES)
    assert type_rows(conn, pid) == SAMPLE_TYPES
    # Cleanup: the archive is gone once the job ends.
    assert conn.execute("select count(*) n from project_uploads").fetchone()["n"] == 0


def test_restart_mid_parse_leaves_no_duplicates(conn, user_id, database_url):
    pid = create_upload_project(conn, user_id, zip_dir(FIXTURE, "sample"))

    # Simulate a worker that claims the job, writes part of the inventory inside its
    # transaction, then dies (the connection drops without committing).
    crashed = psycopg.connect(database_url, autocommit=True, row_factory=dict_row)
    job = worker_loop.claim(crashed)
    crashed.execute("begin")
    crashed.execute("delete from parsed_files where project_id = %s", (pid,))
    for path in expected_sample_paths()[:5]:
        crashed.execute("insert into parsed_files (project_id, path, lang, loc) "
                        "values (%s, %s, 'ts', 1)", (pid, path))
    crashed.execute(
        "insert into parsed_types (project_id, file_id, name, kind, line) "
        "select %s, id, 'Partial', 'class', 1 from parsed_files where project_id = %s",
        (pid, pid))
    crashed.execute(
        "insert into parsed_edges (project_id, from_file_id, to_file_id) "
        "select %s, a.id, b.id from parsed_files a, parsed_files b "
        "where a.project_id = %s and b.project_id = %s and a.id <> b.id", (pid, pid, pid))
    crashed.close()  # killed mid-parse
    assert job_row(conn, pid)["status"] == "processing"

    # A fresh worker process starts: orphaned job is reset, then completed.
    assert worker_loop.reset_orphaned(conn) == 1
    assert job_row(conn, pid)["status"] == "pending"
    assert worker_loop.process_one(conn, SETTINGS)

    assert project(conn, pid)["status"] == "ready"
    assert job_row(conn, pid)["attempts"] == 2
    assert file_paths(conn, pid) == expected_sample_paths()  # exactly one row per file
    assert edge_paths(conn, pid) == sorted(SAMPLE_EDGES)  # and one per resolved import
    assert type_rows(conn, pid) == SAMPLE_TYPES  # and one per declaration


def test_stale_claim_is_reclaimed_without_restart(conn, user_id):
    pid = create_upload_project(conn, user_id, zip_dir(FIXTURE, "s"))
    worker_loop.claim(conn)  # a worker claims it… and hangs
    conn.execute("update parse_jobs set claimed_at = now() - interval '1 hour'")
    conn.execute("update projects set status = 'parsing'")

    assert worker_loop.reclaim_stale(conn, timeout_min=15) == 1
    assert job_row(conn, pid)["status"] == "pending"
    assert project(conn, pid)["status"] == "pending"
    assert worker_loop.process_one(conn, SETTINGS)
    assert project(conn, pid)["status"] == "ready"


def test_fresh_claims_are_not_reclaimed(conn, user_id):
    create_upload_project(conn, user_id, zip_dir(FIXTURE, "s"))
    worker_loop.claim(conn)
    assert worker_loop.reclaim_stale(conn, timeout_min=15) == 0


def test_hung_attempt_cannot_commit_after_being_reclaimed(conn, user_id):
    pid = create_upload_project(conn, user_id, zip_dir(FIXTURE, "s"))
    stale = worker_loop.claim(conn)
    conn.execute("update parse_jobs set claimed_at = now() - interval '1 hour'")
    worker_loop.reclaim_stale(conn, timeout_min=15)
    assert worker_loop.process_one(conn, SETTINGS)  # attempt 2 completes
    before = file_paths(conn, pid)

    with pytest.raises(LostClaim):  # the hung attempt 1 finally wakes up
        run_job(conn, stale, SETTINGS)
    assert job_row(conn, pid)["status"] == "done"
    assert project(conn, pid)["status"] == "ready"  # not flipped back to 'cloning'
    assert file_paths(conn, pid) == before
    assert len(edge_paths(conn, pid)) == len(SAMPLE_EDGES)

    # Through the loop's error path too: its failure is discarded, not recorded.
    with pytest.raises(LostClaim):
        parse_worker.record_failure(conn, stale, RuntimeError("late"), SETTINGS)
    assert project(conn, pid)["status"] == "ready"


def test_transient_failures_retry_then_fail_visibly(conn, user_id, monkeypatch):
    pid = create_upload_project(conn, user_id, zip_dir(FIXTURE, "s"))

    def boom(*_):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(parse_worker, "fetch_source", boom)
    for attempt in (1, 2):
        assert worker_loop.process_one(conn, SETTINGS)
        assert job_row(conn, pid)["status"] == "pending", attempt
        assert project(conn, pid)["status"] == "pending"
    assert worker_loop.process_one(conn, SETTINGS)
    job, p = job_row(conn, pid), project(conn, pid)
    assert (job["status"], job["attempts"]) == ("failed", 3)
    assert p["status"] == "error"
    assert "disk on fire" in p["error_message"]
    assert not worker_loop.process_one(conn, SETTINGS)  # nothing left to retry
    assert file_paths(conn, pid) == []


def test_zip_slip_upload_fails_immediately(conn, user_id, tmp_path):
    archive = zip_entries({"p/ok.py": b"x = 1\n", "../../etc/passwd.py": b"pwned"})
    pid = create_upload_project(conn, user_id, archive)
    assert worker_loop.process_one(conn, SETTINGS)
    job, p = job_row(conn, pid), project(conn, pid)
    assert (job["status"], job["attempts"]) == ("failed", 1)  # not retried
    assert p["status"] == "error" and "escapes the archive root" in p["error_message"]
    assert file_paths(conn, pid) == []


def test_oversized_upload_fails_with_clear_message(conn, user_id):
    archive = zip_entries({"p/a.py": b"#" * (2 * 1024 * 1024)})
    pid = create_upload_project(conn, user_id, archive)
    small = Settings(max_bytes=1024 * 1024, max_files=1000, max_attempts=3, stale_timeout_min=15)
    assert worker_loop.process_one(conn, small)
    assert project(conn, pid)["error_message"] == "Repository is larger than 1MB."


def test_no_source_files_is_an_error(conn, user_id):
    pid = create_upload_project(conn, user_id, zip_entries({"p/README.md": b"# hi"}))
    worker_loop.process_one(conn, SETTINGS)
    assert project(conn, pid)["status"] == "error"
    assert "No Java, JavaScript, TypeScript or Python files" in project(conn, pid)["error_message"]


def test_prune_removes_only_old_finished_jobs(conn, user_id):
    pid = create_upload_project(conn, user_id, zip_dir(FIXTURE, "s"))
    worker_loop.process_one(conn, SETTINGS)
    assert worker_loop.prune_old_jobs(conn) == 0
    conn.execute("update parse_jobs set created_at = now() - interval '31 days'")
    assert worker_loop.prune_old_jobs(conn) == 1
    assert project(conn, pid)["status"] == "ready"  # the project itself is untouched


@pytest.mark.network
def test_github_import(conn, user_id):
    with conn.transaction():
        pid = conn.execute(
            "insert into projects (owner_id, name, source, github_owner, github_repo) "
            "values (%s, 'Spoon-Knife', 'github', 'octocat', 'Spoon-Knife') returning id",
            (user_id,)).fetchone()["id"]
        conn.execute("insert into parse_jobs (project_id) values (%s)", (pid,))
    worker_loop.process_one(conn, SETTINGS)
    # octocat/Spoon-Knife has no source files in our four languages.
    assert project(conn, pid)["status"] == "error"
    assert "No Java" in project(conn, pid)["error_message"]


def test_startup_sweeps_working_copies_left_by_a_hard_kill(conn, user_id):
    parse_worker.WORK_ROOT.mkdir(parents=True, exist_ok=True)
    leftover = parse_worker.WORK_ROOT / "job-killed"
    (leftover / "src").mkdir(parents=True, exist_ok=True)
    (leftover / "src" / "a.py").write_text("x = 1\n")
    assert parse_worker.sweep_work_root() >= 1
    assert not leftover.exists()

    pid = create_upload_project(conn, user_id, zip_dir(FIXTURE, "s"))
    worker_loop.process_one(conn, SETTINGS)
    assert project(conn, pid)["status"] == "ready"
    assert list(parse_worker.WORK_ROOT.iterdir()) == []  # normal runs clean up after themselves
