from fastapi import APIRouter, HTTPException, Depends

from app.core.config import Settings, get_settings
from app.core.db import get_driver
from app.graph import queries

router = APIRouter(tags=["graph"])


@router.get("/repos/{repo_id}/graph")
async def get_graph(repo_id: str):
    """Level-1 graph: Package nodes only."""
    driver = await get_driver()
    return await queries.get_repo_graph(driver, repo_id)


@router.get("/nodes/{node_id}/children")
async def get_children(node_id: str):
    """Expand one level: CONTAINS children of a node."""
    driver = await get_driver()
    return await queries.get_children(driver, node_id)


@router.get("/nodes/{node_id}/neighbours")
async def get_neighbours(node_id: str):
    """Non-CONTAINS edges + their endpoint nodes."""
    driver = await get_driver()
    return await queries.get_neighbours(driver, node_id)


@router.get("/nodes/{node_id}/source")
async def get_source(
    node_id: str,
    settings: Settings = Depends(get_settings),
):
    driver = await get_driver()
    result = await queries.get_node_source(driver, node_id, settings.repos_base_path)
    if result is None:
        raise HTTPException(status_code=404, detail="Node or source file not found.")
    return result


@router.get("/nodes/{node_id}/references")
async def get_references(node_id: str):
    driver = await get_driver()
    return await queries.get_node_references(driver, node_id)


@router.get("/nodes/{node_id}")
async def get_node(node_id: str):
    driver = await get_driver()
    node = await queries.get_node(driver, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found.")
    return node
