import re
import subprocess
import shutil
from pathlib import Path

from fastapi import HTTPException

_GITHUB_HTTPS_RE = re.compile(
    r"^https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+(\.git)?$"
)


def validate_github_url(url: str) -> None:
    if not _GITHUB_HTTPS_RE.match(url.rstrip("/")):
        raise HTTPException(
            status_code=422,
            detail="URL must be a public GitHub HTTPS URL "
                   "(https://github.com/owner/repo).",
        )


def clone_repo(url: str, dest: Path, size_limit_mb: int) -> None:
    """Shallow-clone url into dest; raise if unpacked size exceeds limit."""
    dest.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", "--quiet", url, str(dest)],
            check=True,
            capture_output=True,
            timeout=300,
        )
    except subprocess.CalledProcessError as e:
        shutil.rmtree(dest, ignore_errors=True)
        stderr = e.stderr.decode(errors="replace").strip()
        raise HTTPException(status_code=502, detail=f"git clone failed: {stderr}")
    except subprocess.TimeoutExpired:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(status_code=504, detail="git clone timed out.")

    _check_size(dest, size_limit_mb)


def _check_size(path: Path, limit_mb: int) -> None:
    total_bytes = sum(
        f.stat().st_size for f in path.rglob("*") if f.is_file()
    )
    if total_bytes > limit_mb * 1024 * 1024:
        shutil.rmtree(path, ignore_errors=True)
        raise HTTPException(
            status_code=413,
            detail=f"Repository exceeds the {limit_mb} MB size limit.",
        )
