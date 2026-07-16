from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.db import get_driver, close_driver
from app.api.health import router as health_router
from app.api.repos import router as repos_router
from app.api.parse import router as parse_router
from app.api.graph import router as graph_router
from app.api.analysis import router as analysis_router
from app.api.ai import router as ai_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_driver()
    yield
    await close_driver()


app = FastAPI(title="RepoGraph", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(repos_router, prefix="/api")
app.include_router(parse_router, prefix="/api")
app.include_router(graph_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
