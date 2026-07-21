import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import HTTPException

from app.core.config import get_settings

log = logging.getLogger(__name__)

_MODEL_NAME = "gemini-1.5-flash"
_RETRY_DELAYS = [2, 8]  # seconds; retries on rate limit before giving up

# In-memory response cache: (repo_id, node_id, tool) → JSON payload string.
# Cleared on restart — good enough for v1, no Redis needed.
_cache: dict[tuple, str] = {}

_client = None


def cache_get(repo_id: str, node_id: str, tool: str) -> str | None:
    return _cache.get((repo_id, node_id, tool))


def cache_set(repo_id: str, node_id: str, tool: str, response: str) -> None:
    _cache[(repo_id, node_id, tool)] = response


def get_client():
    global _client
    key = get_settings().gemini_api_key
    if not key:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    if _client is None:
        from google import genai

        _client = genai.Client(api_key=key)
    return _client


def _is_rate_limit(exc: Exception) -> bool:
    text = str(exc)
    return "429" in text or "RESOURCE_EXHAUSTED" in text or "rate" in text.lower()


async def stream_prompt(prompt: str) -> AsyncIterator[str]:
    """Yield text deltas from Gemini, retrying on rate limits with backoff."""
    client = get_client()

    for attempt, delay in enumerate([0, *_RETRY_DELAYS]):
        if delay:
            log.warning("gemini rate limited — retrying in %ds (attempt %d)", delay, attempt + 1)
            await asyncio.sleep(delay)
        streamed = False
        try:
            stream = await client.aio.models.generate_content_stream(
                model=_MODEL_NAME,
                contents=prompt,
            )
            async for chunk in stream:
                if chunk.text:
                    streamed = True
                    yield chunk.text
            return
        except Exception as exc:
            # retry only on rate limit, and only if nothing was streamed yet
            if not streamed and _is_rate_limit(exc) and attempt < len(_RETRY_DELAYS):
                continue
            raise


def sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def stream_cached(text: str, chunk_size: int = 40) -> AsyncIterator[str]:
    """Replay a cached response in small chunks so the UI still feels live."""
    for i in range(0, len(text), chunk_size):
        yield text[i : i + chunk_size]
        await asyncio.sleep(0.01)
