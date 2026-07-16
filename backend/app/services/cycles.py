from neo4j import AsyncDriver


async def get_cycles(driver: AsyncDriver, repo_id: str) -> dict:
    """Return full import cycle paths (A→B→C→A), deduplicated by canonical node set."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (a:File {repo_id: $id})
            MATCH path = (a)-[:IMPORTS*2..8]->(a)
            RETURN [n IN nodes(path) | {
                id:        n.id,
                name:      n.name,
                file_path: n.file_path
            }] AS cycle_nodes
            LIMIT 30
            """,
            id=repo_id,
        )

        seen: set[frozenset] = set()
        cycles = []
        async for record in result:
            raw = record["cycle_nodes"]
            # deduplicate by the set of interior node ids (exclude the repeated last node)
            interior = frozenset(n["id"] for n in raw[:-1])
            if interior in seen:
                continue
            seen.add(interior)
            cycles.append({"nodes": [dict(n) for n in raw]})

    return {"cycles": cycles, "count": len(cycles)}
