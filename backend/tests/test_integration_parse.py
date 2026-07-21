"""Integration test — requires a running Neo4j (auto-skips otherwise)."""

import uuid
from pathlib import Path

import pytest

from app.core.db import close_driver, get_driver
from app.parser.orchestrator import RepoOrchestrator

pytestmark = pytest.mark.integration

FIXTURE = Path(__file__).parent / "fixtures" / "mini_repo"


async def _neo4j_available() -> bool:
    try:
        driver = await get_driver()
        await driver.verify_connectivity()
        return True
    except Exception:
        return False


async def test_parse_mini_repo_end_to_end():
    if not await _neo4j_available():
        pytest.skip("Neo4j not reachable")

    repo_id = f"test-{uuid.uuid4()}"
    driver = await get_driver()
    try:
        stats = await RepoOrchestrator(repo_id=repo_id, repo_root=FIXTURE).run(driver)
        assert stats["files"] == 3
        assert stats["nodes"] > 0

        async with driver.session() as session:
            res = await session.run(
                "MATCH (c:Class {repo_id: $id}) RETURN collect(c.name) AS names", id=repo_id
            )
            names = (await res.single())["names"]
            assert "UserService" in names
            assert "UserRepo" in names

            res = await session.run(
                """
                MATCH (a:File {repo_id: $id})-[:IMPORTS]->(b:File {repo_id: $id})
                RETURN count(*) AS cnt
                """,
                id=repo_id,
            )
            assert (await res.single())["cnt"] >= 1

            res = await session.run(
                "MATCH (e:RestEndpoint {repo_id: $id}) RETURN e.name AS name LIMIT 1", id=repo_id
            )
            record = await res.single()
            assert record and "POST" in record["name"]
    finally:
        async with driver.session() as session:
            await session.run("MATCH (n:Node {repo_id: $id}) DETACH DELETE n", id=repo_id)
        await close_driver()
