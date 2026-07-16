import asyncio
import json
from typing import AsyncIterator

from fastapi import HTTPException

from app.core.config import get_settings

_MODEL_NAME = "gemini-1.5-flash"

# In-memory response cache: (repo_id, node_id, tool) → full response text.
# Cleared on restart — good enough for v1, no Redis needed.
_cache: dict[tuple, str] = {}


def cache_get(repo_id: str, node_id: str, tool: str) -> str | None:
    return _cache.get((repo_id, node_id, tool))


def cache_set(repo_id: str, node_id: str, tool: str, response: str) -> None:
    _cache[(repo_id, node_id, tool)] = response


def get_model():
    key = get_settings().gemini_api_key
    if not key:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    import google.generativeai as genai
    genai.configure(api_key=key)
    return genai.GenerativeModel(_MODEL_NAME)


async def stream_prompt(prompt: str) -> AsyncIterator[str]:
    """Yield text deltas from Gemini."""
    model = get_model()
    response = await model.generate_content_async(prompt, stream=True)
    async for chunk in response:
        if chunk.text:
            yield chunk.text


def sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def stream_cached(text: str, chunk_size: int = 40) -> AsyncIterator[str]:
    """Replay a cached response in small chunks so the UI still feels live."""
    for i in range(0, len(text), chunk_size):
        yield text[i:i + chunk_size]
        await asyncio.sleep(0.01)
