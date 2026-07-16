from neo4j import AsyncGraphDatabase, AsyncDriver
from .config import get_settings

_driver: AsyncDriver | None = None


async def get_driver() -> AsyncDriver:
    global _driver
    if _driver is None:
        s = get_settings()
        _driver = AsyncGraphDatabase.driver(
            s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password)
        )
    return _driver


async def close_driver() -> None:
    global _driver
    if _driver:
        await _driver.close()
        _driver = None
