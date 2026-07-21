from neo4j import AsyncDriver

_SAFE_RELS = ["CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS"]


async def get_dependencies(driver: AsyncDriver, node_id: str) -> dict:
    async with driver.session() as session:
        used_by_r = await session.run(
            """
            MATCH (m:Node)-[r]->(n:Node {id: $id})
            WHERE type(r) IN ['CALLS','IMPORTS','EXTENDS','IMPLEMENTS']
            RETURN m.name AS name, m.id AS id,
                   [lbl IN labels(m) WHERE lbl <> 'Node'][0] AS type,
                   type(r) AS rel
            ORDER BY m.name
            LIMIT 100
            """,
            id=node_id,
        )
        used_by = []
        async for record in used_by_r:
            used_by.append(
                {
                    "name": record["name"],
                    "id": record["id"],
                    "type": record["type"] or "Node",
                    "rel": record["rel"],
                }
            )

        depends_on_r = await session.run(
            """
            MATCH (n:Node {id: $id})-[r]->(m:Node)
            WHERE type(r) IN ['CALLS','IMPORTS','EXTENDS','IMPLEMENTS']
            RETURN m.name AS name, m.id AS id,
                   [lbl IN labels(m) WHERE lbl <> 'Node'][0] AS type,
                   type(r) AS rel
            ORDER BY m.name
            LIMIT 100
            """,
            id=node_id,
        )
        depends_on = []
        async for record in depends_on_r:
            depends_on.append(
                {
                    "name": record["name"],
                    "id": record["id"],
                    "type": record["type"] or "Node",
                    "rel": record["rel"],
                }
            )

    return {"used_by": used_by, "depends_on": depends_on}
