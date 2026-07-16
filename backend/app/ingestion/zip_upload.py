import zipfile
import shutil
from pathlib import Path

from fastapi import HTTPException


def safe_extract(zip_path: Path, dest: Path, size_limit_mb: int) -> None:
    """Extract zip_path into dest with path-traversal and size guards."""
    dest.mkdir(parents=True, exist_ok=True)
    limit_bytes = size_limit_mb * 1024 * 1024

    try:
        with zipfile.ZipFile(zip_path) as zf:
            _validate_members(zf, dest, limit_bytes)
            zf.extractall(dest)
    except zipfile.BadZipFile:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP.")
    except HTTPException:
        shutil.rmtree(dest, ignore_errors=True)
        raise


def _validate_members(zf: zipfile.ZipFile, dest: Path, limit_bytes: int) -> None:
    total = 0
    dest_resolved = dest.resolve()

    for info in zf.infolist():
        # Reject absolute paths and traversal sequences
        if info.filename.startswith("/") or ".." in info.filename:
            raise HTTPException(
                status_code=400,
                detail=f"Unsafe path in ZIP: {info.filename!r}",
            )

        # Confirm resolved target stays inside dest
        target = (dest / info.filename).resolve()
        if not str(target).startswith(str(dest_resolved)):
            raise HTTPException(
                status_code=400,
                detail=f"Path traversal detected: {info.filename!r}",
            )

        total += info.file_size
        if total > limit_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"ZIP contents exceed the size limit.",
            )
