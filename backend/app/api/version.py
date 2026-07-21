import subprocess
from functools import lru_cache

from fastapi import APIRouter

from app.core.config import APP_VERSION

router = APIRouter()


@lru_cache
def _git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


@router.get("/version")
async def version():
    return {"version": APP_VERSION, "build": "dev", "commit": _git_commit()}
