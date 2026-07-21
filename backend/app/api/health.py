import os
from pathlib import Path

from fastapi import APIRouter

from app.core.config import APP_VERSION, get_settings
from app.core.db import get_driver

router = APIRouter()


@router.get("/health")
async def health():
    settings = get_settings()

    # Neo4j connectivity
    try:
        driver = await get_driver()
        await driver.verify_connectivity()
        neo4j_status = "connected"
    except Exception:
        neo4j_status = "unreachable"

    # Gemini key configured
    gemini_status = "configured" if settings.gemini_api_key else "missing_key"

    # Repos path writable
    base = Path(settings.repos_base_path)
    try:
        base.mkdir(parents=True, exist_ok=True)
        repos_status = "available" if os.access(base, os.W_OK) else "not_writable"
    except OSError:
        repos_status = "not_writable"

    overall = "ok" if neo4j_status == "connected" and repos_status == "available" else "degraded"

    return {
        "status": overall,
        "neo4j": neo4j_status,
        "gemini": gemini_status,
        "repos_path": repos_status,
        "version": APP_VERSION,
    }
