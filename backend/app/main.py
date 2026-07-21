import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from neo4j.exceptions import ServiceUnavailable

from app.api.ai import router as ai_router
from app.api.analysis import router as analysis_router
from app.api.graph import router as graph_router
from app.api.health import router as health_router
from app.api.parse import router as parse_router
from app.api.repos import router as repos_router
from app.api.version import router as version_router
from app.core.config import APP_VERSION
from app.core.db import close_driver, get_driver

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
)
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_driver()
    log.info("RepoGraph %s started", APP_VERSION)
    yield
    await close_driver()


app = FastAPI(title="RepoGraph", version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ServiceUnavailable)
async def neo4j_unavailable(request, exc):
    log.error("neo4j unavailable: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=503,
        content={"error": "Database unreachable — is Neo4j running?", "code": "NEO4J_DOWN"},
    )


@app.exception_handler(Exception)
async def unhandled(request, exc):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "code": "INTERNAL"},
    )


app.include_router(health_router, prefix="/api")
app.include_router(version_router, prefix="/api")
app.include_router(repos_router, prefix="/api")
app.include_router(parse_router, prefix="/api")
app.include_router(graph_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
