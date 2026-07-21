import logging
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from neo4j.exceptions import ServiceUnavailable
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.db import get_driver
from app.graph.repos import create_repo_node
from app.ingestion.clone import clone_repo, validate_github_url
from app.ingestion.language import detect_language
from app.ingestion.zip_upload import safe_extract

log = logging.getLogger(__name__)
router = APIRouter(prefix="/repos", tags=["repos"])


class CloneRequest(BaseModel):
    url: str


class RepoResponse(BaseModel):
    repo_id: str
    name: str
    local_path: str
    primary_language: str
    language_breakdown: dict


@router.post("/clone", response_model=RepoResponse, status_code=201)
async def clone(
    body: CloneRequest,
    settings: Settings = Depends(get_settings),
):
    validate_github_url(body.url)

    repo_id = str(uuid.uuid4())
    name = body.url.rstrip("/").rstrip(".git").rsplit("/", 1)[-1]
    dest = Path(settings.repos_base_path) / repo_id

    clone_repo(body.url, dest, settings.repo_size_limit_mb)
    log.info("repo cloned: %s (%s)", name, repo_id)

    lang_info = detect_language(dest)

    try:
        driver = await get_driver()
        await create_repo_node(
            driver,
            repo_id=repo_id,
            name=name,
            source_url=body.url,
            local_path=str(dest),
            primary_language=lang_info["primary"],
            language_breakdown=lang_info["breakdown"],
        )
    except (ServiceUnavailable, OSError):
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(
            status_code=503,
            detail=f"Cannot reach Neo4j at {settings.neo4j_uri} — is it running? "
            "Try: docker compose up -d neo4j",
        )

    return RepoResponse(
        repo_id=repo_id,
        name=name,
        local_path=str(dest),
        primary_language=lang_info["primary"],
        language_breakdown=lang_info["breakdown"],
    )


@router.post("/upload", response_model=RepoResponse, status_code=201)
async def upload(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
):
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted.")

    repo_id = str(uuid.uuid4())
    name = file.filename.removesuffix(".zip")
    dest = Path(settings.repos_base_path) / repo_id

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp_path = Path(tmp.name)
        content = await file.read()
        tmp.write(content)

    # Rough size check before extraction
    if len(content) > settings.repo_size_limit_mb * 1024 * 1024:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=413,
            detail=f"Upload exceeds the {settings.repo_size_limit_mb} MB limit.",
        )

    try:
        safe_extract(tmp_path, dest, settings.repo_size_limit_mb)
    finally:
        tmp_path.unlink(missing_ok=True)
    log.info("zip extracted: %s (%s)", name, repo_id)

    lang_info = detect_language(dest)

    try:
        driver = await get_driver()
        await create_repo_node(
            driver,
            repo_id=repo_id,
            name=name,
            source_url="",
            local_path=str(dest),
            primary_language=lang_info["primary"],
            language_breakdown=lang_info["breakdown"],
        )
    except (ServiceUnavailable, OSError):
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(
            status_code=503,
            detail=f"Cannot reach Neo4j at {settings.neo4j_uri} — is it running? "
            "Try: docker compose up -d neo4j",
        )

    return RepoResponse(
        repo_id=repo_id,
        name=name,
        local_path=str(dest),
        primary_language=lang_info["primary"],
        language_breakdown=lang_info["breakdown"],
    )
