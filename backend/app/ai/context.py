from neo4j import AsyncDriver

from app.graph.queries import get_node, get_node_references, get_node_source


def estimate_tokens(text: str) -> int:
    return len(text) // 4


async def build_node_context(driver: AsyncDriver, node_id: str, repos_base: str) -> dict | None:
    """Target node's metadata + source + direct references, for the per-node AI tools."""
    node = await get_node(driver, node_id)
    if not node:
        return None
    data = node["data"]

    source = await get_node_source(driver, node_id, repos_base)
    refs = await get_node_references(driver, node_id)

    return {
        "node": data,
        "source": source["source"] if source else "",
        "language": source["language"] if source else "plaintext",
        "calls": [r.get("name") or r.get("label", "") for r in refs["calls"]],
        "used_by": [r.get("name") or r.get("label", "") for r in refs["used_by"]],
        "imports": [r.get("name") or r.get("label", "") for r in refs["imports"]],
    }


async def build_impact_context(driver: AsyncDriver, node_id: str) -> list[dict]:
    """Everything that transitively calls or imports the node, up to 3 hops."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (n:Node {id: $id})<-[:CALLS|IMPORTS*1..3]-(affected:Node)
            RETURN DISTINCT affected.name AS name,
                   [lbl IN labels(affected) WHERE lbl <> 'Node'][0] AS type,
                   affected.id AS id,
                   affected.file_path AS file_path
            LIMIT 30
            """,
            id=node_id,
        )
        return [dict(r) async for r in result]


async def get_method_names(driver: AsyncDriver, node_id: str, limit: int = 10) -> list[str]:
    """Method names contained in a Class or File — used by the summarize tool."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (n:Node {id: $id})-[:CONTAINS*1..2]->(m:Method)
            RETURN m.name AS name LIMIT $limit
            """,
            id=node_id,
            limit=limit,
        )
        return [r["name"] async for r in result]


def collect_source_citations(context_blocks: list[dict]) -> list[str]:
    """Unique file paths from the context blocks that fed the prompt, in order."""
    seen: list[str] = []
    for block in context_blocks:
        fp = block.get("file_path") or block.get("node", {}).get("file_path")
        if fp and fp not in seen:
            seen.append(fp)
    return seen


async def get_repo_node_names(driver: AsyncDriver, repo_id: str) -> dict[str, dict]:
    """name → {id, name} map for matching node mentions in AI responses."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (n:Node {repo_id: $id})
            WHERE n:Class OR n:Interface OR n:Method OR n:File
            RETURN n.name AS name, n.id AS id
            """,
            id=repo_id,
        )
        names: dict[str, dict] = {}
        async for r in result:
            if r["name"] and len(r["name"]) >= 3:
                names.setdefault(r["name"], {"id": r["id"], "name": r["name"]})
        return names


def match_mentioned_nodes(text: str, name_map: dict[str, dict], limit: int = 10) -> list[dict]:
    """Find node names mentioned in the AI response, longest names first."""
    mentioned: list[dict] = []
    for name in sorted(name_map, key=len, reverse=True):
        if len(mentioned) >= limit:
            break
        if name in text:
            mentioned.append(name_map[name])
    return mentioned
