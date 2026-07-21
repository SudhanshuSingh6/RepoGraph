import logging

from neo4j import AsyncDriver

from app.parser.base import EdgeData, NodeData

from .schema import create_schema

log = logging.getLogger(__name__)

_SAFE_LABELS = {
    "Package",
    "File",
    "Class",
    "Interface",
    "Enum",
    "Method",
    "RestEndpoint",
    "ExternalLib",
    "Repo",
}

_SAFE_REL_TYPES = {
    "CONTAINS",
    "IMPORTS",
    "CALLS",
    "EXTENDS",
    "IMPLEMENTS",
    "EXPOSES_ENDPOINT",
    "DEPENDS_ON",
}

_BATCH = 500


async def write_nodes(driver: AsyncDriver, nodes: list[NodeData]) -> None:
    if not nodes:
        return
    await create_schema(driver)

    # Group by type so we can set the right label with a literal in Cypher
    by_type: dict[str, list[dict]] = {}
    for n in nodes:
        label = n.type if n.type in _SAFE_LABELS else "Node"
        by_type.setdefault(label, []).append(
            {
                "id": n.id,
                "name": n.name,
                "repo_id": n.repo_id,
                "file_path": n.file_path,
                "start_line": n.start_line,
                "end_line": n.end_line,
                **n.properties,
            }
        )

    async with driver.session() as session:
        for label, records in by_type.items():
            # label is from _SAFE_LABELS, not user input — f-string is safe
            query = f"""
            UNWIND $rows AS props
            MERGE (n:Node {{id: props.id}})
            SET n:{label}
            SET n += props
            """
            for i in range(0, len(records), _BATCH):
                batch = records[i : i + _BATCH]
                try:
                    await session.run(query, rows=batch)
                except Exception as exc:
                    log.error("write_nodes batch failed (%s): %s", label, exc)

    log.info("graph built: %d nodes written", len(nodes))


async def write_edges(driver: AsyncDriver, edges: list[EdgeData]) -> None:
    if not edges:
        return

    by_type: dict[str, list[dict]] = {}
    for e in edges:
        rel = e.type if e.type in _SAFE_REL_TYPES else None
        if rel is None:
            continue
        by_type.setdefault(rel, []).append(
            {
                "src": e.source_id,
                "tgt": e.target_id,
            }
        )

    async with driver.session() as session:
        for rel_type, records in by_type.items():
            query = f"""
            UNWIND $rows AS row
            MATCH (src:Node {{id: row.src}})
            MATCH (tgt:Node {{id: row.tgt}})
            MERGE (src)-[:{rel_type}]->(tgt)
            """
            for i in range(0, len(records), _BATCH):
                batch = records[i : i + _BATCH]
                try:
                    await session.run(query, rows=batch)
                except Exception as exc:
                    log.error("write_edges batch failed (%s): %s", rel_type, exc)

    log.info("graph built: %d edges written", len(edges))
