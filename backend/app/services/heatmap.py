from neo4j import AsyncDriver


def _risk(complexity: int | None) -> str:
    if complexity is None:
        return "Unknown"
    if complexity <= 3:
        return "Low"
    if complexity <= 7:
        return "Medium"
    if complexity <= 12:
        return "High"
    return "Critical"


async def get_heatmap(driver: AsyncDriver, repo_id: str) -> dict:
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (n:Node {repo_id: $id})
            WHERE n:Class OR n:Method
            OPTIONAL MATCH (n)<-[:CALLS]-(caller)
            OPTIONAL MATCH (n)-[:CALLS]->(callee)
            RETURN n,
                   count(DISTINCT caller) AS fan_in,
                   count(DISTINCT callee) AS fan_out
            """,
            id=repo_id,
        )
        nodes = []
        async for record in result:
            n = record["n"]
            props = dict(n)
            cx = props.get("complexity")
            nodes.append(
                {
                    "id": props.get("id", ""),
                    "name": props.get("name", ""),
                    "type": list(n.labels)[0] if n.labels else "Node",
                    "file_path": props.get("file_path", ""),
                    "complexity": cx,
                    "lines": props.get("lines"),
                    "fan_in": record["fan_in"],
                    "fan_out": record["fan_out"],
                    "risk": _risk(cx),
                }
            )

    return {"nodes": nodes}
