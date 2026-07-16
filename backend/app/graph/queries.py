from pathlib import Path
from neo4j import AsyncDriver

_EXT_TO_LANG = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".java": "java",
}


def _node_to_cy(record) -> dict:
    n = record
    props = dict(n)
    return {
        "data": {
            "id": props.get("id", ""),
            "label": props.get("name", ""),
            "type": next((l for l in n.labels if l != "Node"), props.get("type", "")),
            **{k: v for k, v in props.items() if k not in ("id",)},
        }
    }


def _edge_to_cy(src_id: str, tgt_id: str, rel_type: str) -> dict:
    return {
        "data": {
            "id": f"{src_id}__{tgt_id}__{rel_type}",
            "source": src_id,
            "target": tgt_id,
            "type": rel_type,
        }
    }


async def get_repo_graph(driver: AsyncDriver, repo_id: str) -> dict:
    """Level-1: return Package nodes only (+ CONTAINS edges between packages)."""
    async with driver.session() as session:
        # Packages
        res = await session.run(
            "MATCH (n:Node {repo_id: $id}) WHERE n:Package RETURN n",
            id=repo_id,
        )
        nodes = [_node_to_cy(r["n"]) async for r in res]

        # CONTAINS edges between packages (sub-packages)
        res2 = await session.run(
            """
            MATCH (a:Package {repo_id: $id})-[r:CONTAINS]->(b:Package {repo_id: $id})
            RETURN a.id AS src, b.id AS tgt
            """,
            id=repo_id,
        )
        edges = [_edge_to_cy(r["src"], r["tgt"], "CONTAINS") async for r in res2]

    return {"nodes": nodes, "edges": edges}


async def get_children(driver: AsyncDriver, parent_id: str) -> dict:
    """Return direct CONTAINS children of a node."""
    async with driver.session() as session:
        res = await session.run(
            """
            MATCH (p:Node {id: $id})-[:CONTAINS]->(c)
            RETURN c
            """,
            id=parent_id,
        )
        nodes = [_node_to_cy(r["c"]) async for r in res]

    edges = [_edge_to_cy(parent_id, n["data"]["id"], "CONTAINS") for n in nodes]
    return {"nodes": nodes, "edges": edges}


async def get_neighbours(driver: AsyncDriver, node_id: str) -> dict:
    """Return non-CONTAINS edges + their endpoint nodes."""
    async with driver.session() as session:
        res = await session.run(
            """
            MATCH (n:Node {id: $id})-[r]-(m:Node)
            WHERE type(r) <> 'CONTAINS'
            RETURN m, type(r) AS rel, startNode(r).id AS src, endNode(r).id AS tgt
            LIMIT 100
            """,
            id=node_id,
        )
        seen_nodes: dict[str, dict] = {}
        edges: list[dict] = []
        async for r in res:
            m_cy = _node_to_cy(r["m"])
            mid = m_cy["data"]["id"]
            if mid not in seen_nodes:
                seen_nodes[mid] = m_cy
            edges.append(_edge_to_cy(r["src"], r["tgt"], r["rel"]))

    return {"nodes": list(seen_nodes.values()), "edges": edges}


async def get_node(driver: AsyncDriver, node_id: str) -> dict | None:
    async with driver.session() as session:
        res = await session.run(
            "MATCH (n:Node {id: $id}) RETURN n LIMIT 1",
            id=node_id,
        )
        record = await res.single()
        if not record:
            return None
        return _node_to_cy(record["n"])


async def get_node_source(driver: AsyncDriver, node_id: str, repos_base: str) -> dict | None:
    node = await get_node(driver, node_id)
    if not node:
        return None

    data = node["data"]
    repo_id = data.get("repo_id", "")
    file_path = data.get("file_path", "")
    start_line = int(data.get("start_line", 1))
    end_line = int(data.get("end_line", start_line))

    if not repo_id or not file_path:
        return None

    abs_path = Path(repos_base) / repo_id / file_path
    try:
        lines = abs_path.read_text(errors="replace").splitlines()
    except OSError:
        return None

    # start_line/end_line are 1-indexed
    snippet = "\n".join(lines[max(0, start_line - 1): end_line])
    lang = _EXT_TO_LANG.get(Path(file_path).suffix.lower(), "plaintext")

    return {
        "language": lang,
        "source": snippet,
        "highlight_start": start_line,
        "highlight_end": end_line,
    }


async def get_node_references(driver: AsyncDriver, node_id: str) -> dict:
    """Return categorised references: calls, used_by, imports, extends, implements."""
    async with driver.session() as session:
        # Outgoing
        out = await session.run(
            """
            MATCH (n:Node {id: $id})-[r]->(m:Node)
            WHERE type(r) <> 'CONTAINS'
            RETURN m, type(r) AS rel
            """,
            id=node_id,
        )
        outgoing: dict[str, list] = {}
        async for r in out:
            rel = r["rel"].lower()
            outgoing.setdefault(rel, []).append(_node_to_cy(r["m"])["data"])

        # Incoming
        inc = await session.run(
            """
            MATCH (m:Node)-[r]->(n:Node {id: $id})
            WHERE type(r) <> 'CONTAINS'
            RETURN m, type(r) AS rel
            """,
            id=node_id,
        )
        incoming: dict[str, list] = {}
        async for r in inc:
            rel = r["rel"].lower()
            incoming.setdefault(rel, []).append(_node_to_cy(r["m"])["data"])

    return {
        "calls": outgoing.get("calls", []),
        "used_by": incoming.get("calls", []),
        "imports": outgoing.get("imports", []),
        "extends": outgoing.get("extends", []),
        "implements": outgoing.get("implements", []),
    }
