from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "repograph"
    gemini_api_key: str = ""
    repo_size_limit_mb: int = 500
    repos_base_path: str = "/repos"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
