"""Integration tests run against a throwaway database on the DATABASE_URL server:
created and migrated from db/migrations/*.sql per test session, dropped afterwards."""

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row

MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"


@pytest.fixture(scope="session")
def database_url():
    base = os.environ.get("DATABASE_URL")
    if not base:
        pytest.skip("DATABASE_URL not set")
    try:
        admin = psycopg.connect(base, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres not reachable: {e}")
    name = f"repograph_test_{uuid.uuid4().hex[:8]}"
    admin.execute(f'create database "{name}"')
    url = make_conninfo(**{**conninfo_to_dict(base), "dbname": name})
    with psycopg.connect(url, autocommit=True) as conn:
        for f in sorted(MIGRATIONS.glob("*.sql")):
            conn.execute(f.read_text())
    try:
        yield url
    finally:
        admin.execute(f'drop database "{name}" with (force)')
        admin.close()


@pytest.fixture
def conn(database_url):
    with psycopg.connect(database_url, autocommit=True, row_factory=dict_row) as c:
        yield c
        c.execute("truncate users, projects cascade")


@pytest.fixture
def user_id(conn):
    return conn.execute(
        "insert into users (github_id, username) values (%s, 'tester') returning id",
        (uuid.uuid4().int % 10**9,),
    ).fetchone()["id"]
