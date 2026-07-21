from neo4j import AsyncDriver

from app.ai.context import build_node_context, estimate_tokens
from app.ai.embeddings import embed_query


async def semantic_search(
    driver: AsyncDriver, repo_id: str, query_text: str, k: int = 10
) -> list[dict]:
    vector = await embed_query(query_text)

    async with driver.session() as session:
        # over-fetch then filter by repo, since the index spans all repos
        result = await session.run(
            """
            CALL db.index.vector.queryNodes('node_embeddings', $k, $embedding)
            YIELD node, score
            WHERE node.repo_id = $repo_id AND score > 0.5
            RETURN node.id AS id, node.name AS name,
                   [lbl IN labels(node) WHERE lbl <> 'Node'][0] AS type,
                   node.file_path AS file_path,
                   node.embed_text AS embed_text,
                   score
            ORDER BY score DESC
            """,
            k=k * 3,
            embedding=vector,
            repo_id=repo_id,
        )
        results = []
        async for r in result:
            if len(results) >= k:
                break
            preview = (r["embed_text"] or "")[:120].replace("\n\n", " · ").replace("\n", " ")
            results.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "type": r["type"] or "Node",
                    "file_path": r["file_path"] or "",
                    "score": round(r["score"], 3),
                    "preview": preview,
                }
            )
        return results


async def build_chat_context(
    driver: AsyncDriver,
    repo_id: str,
    question: str,
    repos_base: str,
    max_tokens: int = 4000,
) -> tuple[str, list[dict], list[str]]:
    """Token-budget GraphRAG context. Returns (context_text, hit_nodes, citations)."""
    hits = await semantic_search(driver, repo_id, question, k=10)

    blocks: list[str] = []
    citations: list[str] = []
    used = 0

    for hit in hits[:5]:
        ctx = await build_node_context(driver, hit["id"], repos_base)
        if not ctx:
            continue
        node = ctx["node"]
        block = (
            f"### {node.get('type', 'Node')}: {node.get('label') or node.get('name', '')}\n"
            f"File: {node.get('file_path', '')}\n"
            f"Called by: {', '.join(ctx['used_by'][:5]) or 'none'}\n"
            f"Calls: {', '.join(ctx['calls'][:5]) or 'none'}\n"
            f"```{ctx['language']}\n{ctx['source'][:1200]}\n```"
        )
        cost = estimate_tokens(block)
        if used + cost > max_tokens:
            break  # never truncate mid-block
        blocks.append(block)
        used += cost
        fp = node.get("file_path")
        if fp and fp not in citations:
            citations.append(fp)

    # remaining hits contribute name-only context if budget allows
    remainder = hits[5:]
    if remainder and used < max_tokens - 100:
        names = ", ".join(f"{h['name']} ({h['type']})" for h in remainder)
        blocks.append(f"Other possibly relevant components: {names}")

    return "\n\n".join(blocks), hits, citations
