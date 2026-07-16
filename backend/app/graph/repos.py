import json
from datetime import datetime, timezone

from neo4j import AsyncDriver


async def create_repo_node(
    driver: AsyncDriver,
    *,
    repo_id: str,
    name: str,
    source_url: str,
    local_path: str,
    primary_language: str,
    language_breakdown: dict,
) -> None:
    query = """
    MERGE (r:Repo {id: $id})
    SET r.name = $name,
        r.source_url = $source_url,
        r.local_path = $local_path,
        r.primary_language = $primary_language,
        r.language_breakdown = $breakdown,
        r.status = 'ingested',
        r.created_at = $created_at
    """
    async with driver.session() as session:
        await session.run(
            query,
            id=repo_id,
            name=name,
            source_url=source_url,
            local_path=local_path,
            primary_language=primary_language,
            breakdown=json.dumps(language_breakdown),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
