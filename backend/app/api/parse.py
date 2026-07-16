import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.core.db import get_driver
from app.core import job_status
from app.parser.orchestrator import RepoOrchestrator

log = logging.getLogger(__name__)
router = APIRouter(prefix="/repos", tags=["parse"])


@router.post("/{repo_id}/parse", status_code=202)
async def start_parse(repo_id: str):
    settings = get_settings()
    repo_root = Path(settings.repos_base_path) / repo_id

    if not repo_root.exists():
        raise HTTPException(status_code=404, detail="Repo not found — clone or upload it first.")

    current = job_status.get_status(repo_id)
    if current.get("status") == "parsing":
        return {"status": "parsing", "detail": "Already in progress."}

    job_status.set_status(repo_id, "parsing")
    asyncio.create_task(_run_parse(repo_id, repo_root))
    return {"status": "parsing"}


@router.get("/{repo_id}/status")
async def get_parse_status(repo_id: str):
    return job_status.get_status(repo_id)


async def _run_parse(repo_id: str, repo_root: Path) -> None:
    try:
        driver = await get_driver()
        orchestrator = RepoOrchestrator(repo_id=repo_id, repo_root=repo_root)

        def on_progress(done: int, total: int) -> None:
            job_status.set_status(repo_id, "parsing", progress=f"{done}/{total}")

        await orchestrator.run(driver, on_progress=on_progress)
        job_status.set_status(repo_id, "ready")
        log.info("repo %s parsed successfully", repo_id)

        from app.ai.embeddings import embed_repo
        asyncio.create_task(embed_repo(driver, repo_id))
    except Exception as exc:
        log.exception("parse failed for repo %s", repo_id)
        job_status.set_status(repo_id, "error", detail=str(exc))
