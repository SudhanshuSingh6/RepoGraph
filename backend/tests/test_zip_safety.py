import zipfile

import pytest
from fastapi import HTTPException

from app.ingestion.zip_upload import safe_extract


def make_zip(path, entries):
    """entries: list of (filename, content) or ZipInfo objects with content."""
    with zipfile.ZipFile(path, "w") as zf:
        for entry in entries:
            if isinstance(entry[0], zipfile.ZipInfo):
                zf.writestr(entry[0], entry[1])
            else:
                zf.writestr(entry[0], entry[1])
    return path


def test_normal_zip_extracts(tmp_path):
    zp = make_zip(tmp_path / "ok.zip", [("src/main.py", "print('hi')"), ("README.md", "# x")])
    dest = tmp_path / "out"
    safe_extract(zp, dest, size_limit_mb=10)
    assert (dest / "src" / "main.py").read_text() == "print('hi')"


def test_rejects_path_traversal(tmp_path):
    zp = make_zip(tmp_path / "evil.zip", [("../../escape.txt", "pwned")])
    with pytest.raises(HTTPException) as exc:
        safe_extract(zp, tmp_path / "out", size_limit_mb=10)
    assert exc.value.status_code == 400


def test_rejects_absolute_path(tmp_path):
    zp = make_zip(tmp_path / "abs.zip", [("/etc/pwned.txt", "x")])
    with pytest.raises(HTTPException) as exc:
        safe_extract(zp, tmp_path / "out", size_limit_mb=10)
    assert exc.value.status_code == 400


def test_rejects_oversize(tmp_path):
    big = "x" * (2 * 1024 * 1024)  # 2 MB uncompressed
    zp = make_zip(tmp_path / "big.zip", [("big.txt", big)])
    with pytest.raises(HTTPException) as exc:
        safe_extract(zp, tmp_path / "out", size_limit_mb=1)
    assert exc.value.status_code == 413


def test_rejects_symlink(tmp_path):
    info = zipfile.ZipInfo("link.txt")
    info.external_attr = 0o120777 << 16  # symlink mode bits
    zp = make_zip(tmp_path / "link.zip", [(info, "/etc/passwd")])
    with pytest.raises(HTTPException) as exc:
        safe_extract(zp, tmp_path / "out", size_limit_mb=10)
    assert exc.value.status_code == 400
    assert "Symlink" in exc.value.detail


def test_rejects_too_many_files(tmp_path, monkeypatch):
    import app.ingestion.zip_upload as zu

    monkeypatch.setattr(zu, "_MAX_FILE_COUNT", 5)
    zp = make_zip(tmp_path / "many.zip", [(f"f{i}.txt", "x") for i in range(6)])
    with pytest.raises(HTTPException) as exc:
        safe_extract(zp, tmp_path / "out", size_limit_mb=10)
    assert exc.value.status_code == 400
    assert "too many files" in exc.value.detail
