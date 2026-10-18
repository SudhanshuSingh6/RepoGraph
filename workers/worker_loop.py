"""Long-running parse worker: polls parse_jobs, claims one job at a time, runs it.

    npm run worker            # the worker loop
    npm run worker:watchdog   # stale-claim reclaimer only (covers a hung worker)

Run under a process supervisor / restart policy. Durability rules (BUILD_PLAN.md Phase 3a):
  - startup: any job still `processing` was orphaned by a crash → reset to `pending`,
    and any working copy a hard-killed run left on disk is deleted
  - every iteration (and in the watchdog): `processing` jobs claimed longer ago than
    PARSE_STALE_TIMEOUT_MIN are assumed hung → reset to `pending`
  - failures retry up to PARSE_MAX_ATTEMPTS, then fail visibly (`projects.status='error'`)

Startup recovery assumes one worker process. If you run several replicas, start the
extra ones with --no-startup-reset so a restarting replica can't steal a live job (or
delete a live working copy) from another; the stale timeout still covers crashes.
"""

import argparse
import logging
import os
import signal
import sys
import time

import psycopg
from psycopg.rows import dict_row

from parse_worker import Job, LostClaim, Settings, record_failure, run_job, sweep_work_root

log = logging.getLogger("worker")

POLL_INTERVAL_S = 2.0
WATCHDOG_INTERVAL_S = 60.0
PRUNE_INTERVAL_S = 3600.0
RETENTION_DAYS = 30

CLAIM_SQL = """
update parse_jobs set status = 'processing', claimed_at = now(), attempts = attempts + 1
where id = (
  select id from parse_jobs where status = 'pending'
  order by created_at limit 1 for update skip locked
)
returning id, project_id, attempts
"""


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


def load_settings() -> Settings:
    return Settings(
        max_bytes=env_int("IMPORT_MAX_BYTES", 200 * 1024 * 1024),
        max_files=env_int("IMPORT_MAX_FILES", 20_000),
        max_attempts=env_int("PARSE_MAX_ATTEMPTS", 3),
        stale_timeout_min=env_int("PARSE_STALE_TIMEOUT_MIN", 15),
    )


def connect() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set — copy .env.example to .env and fill it in.")
    return psycopg.connect(url, autocommit=True, row_factory=dict_row)


def reset_orphaned(conn: psycopg.Connection) -> int:
    with conn.transaction():
        n = conn.execute(
            "update parse_jobs set status = 'pending' where status = 'processing'").rowcount
        conn.execute(
            "update projects set status = 'pending' where id in "
            "(select project_id from parse_jobs where status = 'pending') "
            "and status in ('cloning', 'parsing')")
    return n


def reclaim_stale(conn: psycopg.Connection, timeout_min: int) -> int:
    with conn.transaction():
        rows = conn.execute(
            "update parse_jobs set status = 'pending' "
            "where status = 'processing' and claimed_at < now() - make_interval(mins => %s) "
            "returning project_id",
            (timeout_min,),
        ).fetchall()
        if rows:
            conn.execute("update projects set status = 'pending' where id = any(%s)",
                         ([r["project_id"] for r in rows],))
    return len(rows)


def prune_old_jobs(conn: psycopg.Connection) -> int:
    return conn.execute(
        "delete from parse_jobs where status in ('done', 'failed') "
        "and created_at < now() - make_interval(days => %s)",
        (RETENTION_DAYS,),
    ).rowcount


def claim(conn: psycopg.Connection) -> Job | None:
    row = conn.execute(CLAIM_SQL).fetchone()
    return Job(id=str(row["id"]), project_id=str(row["project_id"]),
               attempts=row["attempts"]) if row else None


def process_one(conn: psycopg.Connection, settings: Settings) -> bool:
    """Claims and runs one job. Returns False if the queue was empty."""
    job = claim(conn)
    if job is None:
        return False
    log.info("job %s (project %s) attempt %d", job.id, job.project_id, job.attempts)
    try:
        run_job(conn, job, settings)
        log.info("job %s done", job.id)
    except LostClaim:
        log.warning("job %s was reclaimed while running; discarding this attempt", job.id)
    except Exception as e:  # noqa: BLE001 — any failure is recorded on the job
        log.exception("job %s failed", job.id)
        try:
            log.info("job %s → %s", job.id, record_failure(conn, job, e, settings))
        except LostClaim:
            log.warning("job %s was reclaimed while failing; leaving it to the new claim", job.id)
    return True


def run_loop(settings: Settings, startup_reset: bool) -> None:
    conn = connect()
    if startup_reset:
        if n := reset_orphaned(conn):
            log.info("reset %d orphaned job(s) from a previous run", n)
        if n := sweep_work_root():
            log.info("deleted %d leftover working copy(ies) from a previous run", n)
    last_prune = 0.0
    while True:
        if n := reclaim_stale(conn, settings.stale_timeout_min):
            log.warning("reclaimed %d stale job(s)", n)
        if time.monotonic() - last_prune > PRUNE_INTERVAL_S:
            prune_old_jobs(conn)
            last_prune = time.monotonic()
        if not process_one(conn, settings):
            time.sleep(POLL_INTERVAL_S)


def run_watchdog(settings: Settings) -> None:
    conn = connect()
    while True:
        if n := reclaim_stale(conn, settings.stale_timeout_min):
            log.warning("reclaimed %d stale job(s)", n)
        time.sleep(WATCHDOG_INTERVAL_S)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--watchdog", action="store_true",
                        help="only reclaim stale jobs; don't process any")
    parser.add_argument("--no-startup-reset", action="store_true",
                        help="skip resetting orphaned jobs on startup (for extra replicas)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    settings = load_settings()
    if args.watchdog:
        run_watchdog(settings)
    else:
        run_loop(settings, startup_reset=not args.no_startup_reset)


if __name__ == "__main__":
    main()
