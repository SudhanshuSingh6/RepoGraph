from neo4j import AsyncDriver


async def get_endpoints(driver: AsyncDriver, repo_id: str) -> dict:
    """Trace each RestEndpoint → handler → call chain (up to 5 hops)."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (ep:RestEndpoint {repo_id: $id})
            OPTIONAL MATCH (ep)-[:CALLS]->(h:Method)
            OPTIONAL MATCH chain = (h)-[:CALLS*0..5]->(leaf:Method {repo_id: $id})
            WITH ep, h,
                 CASE WHEN chain IS NOT NULL
                      THEN [n IN nodes(chain) | {
                               id:        n.id,
                               name:      n.name,
                               type:      [lbl IN labels(n) WHERE lbl <> 'Node'][0],
                               file_path: n.file_path
                           }]
                      ELSE []
                 END AS call_chain
            WITH ep, h, call_chain
            ORDER BY ep.id, size(call_chain) DESC
            WITH ep, h, collect(call_chain)[0] AS longest_chain
            RETURN ep,
                   CASE WHEN h IS NOT NULL
                        THEN {id: h.id, name: h.name, file_path: h.file_path}
                        ELSE null
                   END AS handler,
                   COALESCE(longest_chain, []) AS call_chain
            ORDER BY ep.path
            LIMIT 100
            """,
            id=repo_id,
        )

        endpoints = []
        async for record in result:
            ep = record["ep"]
            props = dict(ep)
            endpoints.append(
                {
                    "id": props.get("id", ""),
                    "verb": props.get("http_method", props.get("verb", "GET")),
                    "path": props.get("path", ""),
                    "handler": dict(record["handler"]) if record["handler"] else None,
                    "call_chain": [dict(n) for n in (record["call_chain"] or [])],
                }
            )

    return {"endpoints": endpoints}
