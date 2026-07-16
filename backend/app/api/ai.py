import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core import job_status
from app.core.config import get_settings
from app.core.db import get_driver
from app.ai import tools
from app.ai.embeddings import embed_repo
from app.ai.gemini import cache_get, cache_set, sse_event, stream_cached, stream_prompt
from app.ai.context import (
    build_impact_context,
    build_node_context,
    get_method_names,
    get_repo_node_names,
    match_mentioned_nodes,
)
from app.ai.search import build_chat_context, semantic_search
from app.graph.queries import get_node

log = logging.getLogger(__name__)
router = APIRouter(tags=["ai"])

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class ChatBody(BaseModel):
    message: str
    tool: str = "repo"  # "repo" | "architecture"


@router.post("/repos/{repo_id}/embed", status_code=202)
async def start_embed(repo_id: str):
    driver = await get_driver()
    current = job_status.get_embed_status(repo_id)
    if current.get("status") == "running":
        return {"status": "running"}
    job_status.set_embed_status(repo_id, "running")
    asyncio.create_task(embed_repo(driver, repo_id))
    return {"status": "running"}


@router.get("/repos/{repo_id}/embed/status")
async def embed_status(repo_id: str):
    return job_status.get_embed_status(repo_id)


@router.get("/repos/{repo_id}/search")
async def search(repo_id: str, q: str):
    if len(q.strip()) < 2:
        return {"results": []}
    driver = await get_driver()
    results = await semantic_search(driver, repo_id, q.strip())
    return {"results": results}


async def _stream_tool(repo_id: str, node_id: str, tool_name: str, prompt: str, driver):
    """Shared SSE generator: cache check → Gemini stream → done event with nodes+citations."""
    cached = cache_get(repo_id, node_id, tool_name)
    if cached:
        payload = json.loads(cached)
        async for chunk in stream_cached(payload["text"]):
            yield sse_event({"delta": chunk})
        yield sse_event({"done": True, "nodes": payload["nodes"], "citations": payload["citations"]})
        return

    full = ""
    try:
        async for delta in stream_prompt(prompt):
            full += delta
            yield sse_event({"delta": delta})
    except Exception as exc:
        log.exception("gemini stream failed")
        yield sse_event({"error": str(exc)})
        return

    name_map = await get_repo_node_names(driver, repo_id)
    mentioned = match_mentioned_nodes(full, name_map)

    node = await get_node(driver, node_id) if node_id else None
    citations = []
    if node and node["data"].get("file_path"):
        citations.append(node["data"]["file_path"])

    cache_set(repo_id, node_id, tool_name, json.dumps({
        "text": full, "nodes": mentioned, "citations": citations,
    }))
    yield sse_event({"done": True, "nodes": mentioned, "citations": citations})


async def _node_repo_id(driver, node_id: str) -> tuple[dict, str]:
    node = await get_node(driver, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    repo_id = node["data"].get("repo_id", "")
    return node["data"], repo_id


@router.post("/nodes/{node_id}/explain")
async def explain(node_id: str):
    driver = await get_driver()
    _, repo_id = await _node_repo_id(driver, node_id)
    ctx = await build_node_context(driver, node_id, get_settings().repos_base_path)
    if not ctx:
        raise HTTPException(status_code=404, detail="Node not found")
    prompt = tools.explain_node(ctx)
    return StreamingResponse(
        _stream_tool(repo_id, node_id, "explain", prompt, driver),
        media_type="text/event-stream", headers=_SSE_HEADERS,
    )


@router.post("/nodes/{node_id}/summarize")
async def summarize(node_id: str):
    driver = await get_driver()
    _, repo_id = await _node_repo_id(driver, node_id)
    ctx = await build_node_context(driver, node_id, get_settings().repos_base_path)
    if not ctx:
        raise HTTPException(status_code=404, detail="Node not found")
    method_names = await get_method_names(driver, node_id)
    prompt = tools.summarize_node(ctx, method_names)
    return StreamingResponse(
        _stream_tool(repo_id, node_id, "summarize", prompt, driver),
        media_type="text/event-stream", headers=_SSE_HEADERS,
    )


@router.post("/nodes/{node_id}/impact")
async def impact(node_id: str):
    driver = await get_driver()
    node_data, repo_id = await _node_repo_id(driver, node_id)
    affected = await build_impact_context(driver, node_id)
    prompt = tools.impact_analysis(node_data, affected)
    return StreamingResponse(
        _stream_tool(repo_id, node_id, "impact", prompt, driver),
        media_type="text/event-stream", headers=_SSE_HEADERS,
    )


@router.post("/repos/{repo_id}/chat")
async def chat(repo_id: str, body: ChatBody):
    driver = await get_driver()
    settings = get_settings()

    context_text, hits, citations = await build_chat_context(
        driver, repo_id, body.message, settings.repos_base_path,
    )

    # primary language from the Repo node for the prompt
    async with driver.session() as session:
        res = await session.run(
            "MATCH (r:Repo {id: $id}) RETURN r.primary_language AS lang", id=repo_id
        )
        row = await res.single()
        language = (row["lang"] if row else None) or "unknown"

    if body.tool == "architecture":
        prompt = tools.architecture_question(body.message, context_text)
    else:
        prompt = tools.repo_question(body.message, context_text, language)

    async def generate():
        full = ""
        try:
            async for delta in stream_prompt(prompt):
                full += delta
                yield sse_event({"delta": delta})
        except Exception as exc:
            log.exception("gemini chat failed")
            yield sse_event({"error": str(exc)})
            return
        name_map = await get_repo_node_names(driver, repo_id)
        mentioned = match_mentioned_nodes(full, name_map)
        yield sse_event({"done": True, "nodes": mentioned, "citations": citations})

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_SSE_HEADERS)
