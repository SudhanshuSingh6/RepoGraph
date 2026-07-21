import shutil
import zipfile
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


_MAX_FILE_COUNT = 20_000  # zip-bomb guard


def _validate_members(zf: zipfile.ZipFile, dest: Path, limit_bytes: int) -> None:
    total = 0
    dest_resolved = dest.resolve()

    infolist = zf.infolist()
    if len(infolist) > _MAX_FILE_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP contains too many files (max {_MAX_FILE_COUNT}).",
        )

    for info in infolist:
        # Reject symlinks (mode stored in high bits of external_attr)
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise HTTPException(
                status_code=400,
                detail=f"Symlinks not allowed in ZIP: {info.filename!r}",
            )

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
                detail="ZIP contents exceed the size limit.",
            )
