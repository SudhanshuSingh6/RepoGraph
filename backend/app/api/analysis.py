from fastapi import APIRouter

from app.core.db import get_driver
from app.services import cycles, dependencies, endpoints, heatmap, overview

router = APIRouter()


@router.get("/repos/{repo_id}/metrics")
async def repo_metrics(repo_id: str):
    driver = await get_driver()
    return await overview.get_metrics(driver, repo_id)


@router.get("/repos/{repo_id}/overview")
async def repo_overview(repo_id: str):
    driver = await get_driver()
    return await overview.get_overview(driver, repo_id)


@router.get("/repos/{repo_id}/heatmap")
async def repo_heatmap(repo_id: str):
    driver = await get_driver()
    return await heatmap.get_heatmap(driver, repo_id)


@router.get("/repos/{repo_id}/cycles")
async def repo_cycles(repo_id: str):
    driver = await get_driver()
    return await cycles.get_cycles(driver, repo_id)


@router.get("/repos/{repo_id}/endpoints")
async def repo_endpoints(repo_id: str):
    driver = await get_driver()
    return await endpoints.get_endpoints(driver, repo_id)


@router.get("/nodes/{node_id}/dependencies")
async def node_dependencies(node_id: str):
    driver = await get_driver()
    return await dependencies.get_dependencies(driver, node_id)
