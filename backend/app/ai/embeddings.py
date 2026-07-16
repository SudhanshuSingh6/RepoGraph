import asyncio
import logging
from pathlib import Path

from neo4j import AsyncDriver

from app.core import job_status
from app.core.config import get_settings

log = logging.getLogger(__name__)

# Only node types worth searching semantically — skip Package/Enum/ExternalLib
EMBEDDABLE_TYPES = ("Class", "Interface", "Method", "RestEndpoint", "File")

_MODEL_NAME = "BAAI/bge-small-en-v1.5"  # 384-dim, matches node_embeddings index
_model = None


def _get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(model_name=_MODEL_NAME)
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Synchronous batch embed. CPU-bound — call via asyncio.to_thread."""
    return [vec.tolist() for vec in _get_model().embed(texts)]


async def embed_query(text: str) -> list[float]:
    vecs = await asyncio.to_thread(embed_texts, [text])
    return vecs[0]


def _build_embed_text(props: dict, node_type: str, parent_name: str | None,
                      imports: list[str], source_snippet: str) -> str:
    parts = [f"{node_type}: {props.get('name', '')}"]

    context_lines = []
    if parent_name:
        context_lines.append(f"Class: {parent_name}")
    file_path = props.get("file_path", "")
    if file_path:
        context_lines.append(f"File: {Path(file_path).name}")
    if context_lines:
        parts.append("\n".join(context_lines))

    if imports:
        parts.append("Imports:\n" + ", ".join(imports))

    if source_snippet:
        parts.append(source_snippet)

    return "\n\n".join(parts)


def _read_source_snippet(file_cache: dict, repo_root: Path, props: dict, limit: int = 500) -> str:
    file_path = props.get("file_path", "")
    if not file_path:
        return ""
    if file_path not in file_cache:
        try:
            file_cache[file_path] = (repo_root / file_path).read_text(errors="replace").splitlines()
        except OSError:
            file_cache[file_path] = []
    lines = file_cache[file_path]
    if not lines:
        return ""
    start = int(props.get("start_line", 1)) - 1
    end = int(props.get("end_line", start + 1))
    snippet = "\n".join(lines[max(0, start):end])
    return snippet[:limit]


async def embed_repo(driver: AsyncDriver, repo_id: str) -> None:
    """Embed Class/Interface/Method/RestEndpoint/File nodes and write vectors to Neo4j."""
    settings = get_settings()
    repo_root = Path(settings.repos_base_path) / repo_id

    try:
        job_status.set_embed_status(repo_id, "running")

        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (n:Node {repo_id: $id})
                WHERE n:Class OR n:Interface OR n:Method OR n:RestEndpoint OR n:File
                OPTIONAL MATCH (f:File {repo_id: $id})-[:CONTAINS*0..2]->(n)
                OPTIONAL MATCH (f)-[:IMPORTS]->(imp)
                OPTIONAL MATCH (parent:Class)-[:CONTAINS]->(n)
                RETURN n,
                       [lbl IN labels(n) WHERE lbl <> 'Node'][0] AS node_type,
                       parent.name AS parent_name,
                       [x IN collect(DISTINCT imp.name) WHERE x IS NOT NULL][..5] AS imports
                """,
                id=repo_id,
            )
            rows = [
                (dict(r["n"]), r["node_type"], r["parent_name"], r["imports"] or [])
                async for r in result
            ]

        total = len(rows)
        job_status.set_embed_status(repo_id, "running", 0, total)
        if not total:
            job_status.set_embed_status(repo_id, "done", 0, 0)
            return

        file_cache: dict[str, list[str]] = {}
        items = []
        for props, node_type, parent_name, imports in rows:
            snippet = _read_source_snippet(file_cache, repo_root, props)
            text = _build_embed_text(props, node_type or "Node", parent_name, imports, snippet)
            items.append({"id": props["id"], "text": text})

        done = 0
        for i in range(0, len(items), 64):
            batch = items[i:i + 64]
            vectors = await asyncio.to_thread(embed_texts, [it["text"] for it in batch])
            payload = [
                {"id": it["id"], "vec": vec, "text": it["text"]}
                for it, vec in zip(batch, vectors)
            ]
            async with driver.session() as session:
                await session.run(
                    """
                    UNWIND $batch AS row
                    MATCH (n:Node {id: row.id})
                    SET n.embedding = row.vec, n.embed_text = row.text
                    """,
                    batch=payload,
                )
            done += len(batch)
            job_status.set_embed_status(repo_id, "running", done, total)

        job_status.set_embed_status(repo_id, "done", done, total)
        log.info("embedded %d nodes for repo %s", done, repo_id)
    except Exception:
        log.exception("embedding failed for repo %s", repo_id)
        job_status.set_embed_status(repo_id, "error")
