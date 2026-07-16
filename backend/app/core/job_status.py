import threading
from typing import Literal

Status = Literal["pending", "parsing", "ready", "error"]

_lock = threading.Lock()
_store: dict[str, dict] = {}


def set_status(repo_id: str, status: Status, detail: str = "", progress: str = "") -> None:
    with _lock:
        _store[repo_id] = {"status": status, "detail": detail, "progress": progress}


def get_status(repo_id: str) -> dict:
    with _lock:
        return _store.get(repo_id, {"status": "unknown"})


def set_embed_status(repo_id: str, status: str, nodes_embedded: int = 0, total: int = 0) -> None:
    with _lock:
        _store[f"{repo_id}:embed"] = {
            "status": status,
            "nodes_embedded": nodes_embedded,
            "total": total,
        }


def get_embed_status(repo_id: str) -> dict:
    with _lock:
        return _store.get(f"{repo_id}:embed", {"status": "pending", "nodes_embedded": 0, "total": 0})
