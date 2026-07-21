from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent  # .../backend

APP_VERSION = "1.0.0"


class Settings(BaseSettings):
    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "repograph"
    gemini_api_key: str = ""
    repo_size_limit_mb: int = 500
    repos_base_path: str = "/repos"

    class Config:
        # root .env first, backend/.env overrides — anchored to file location, not CWD
        env_file = (_BACKEND_DIR.parent / ".env", _BACKEND_DIR / ".env")
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
