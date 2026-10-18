import io
import stat
import zipfile

import pytest

from source import Caps, ImportRejected, common_root, extract_zip, clone_github

BIG = 10 * 1024 * 1024


def make_zip(entries: dict[str, bytes], symlinks: dict[str, str] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
        for name, target in (symlinks or {}).items():
            info = zipfile.ZipInfo(name)
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            zf.writestr(info, target)
    return buf.getvalue()


def files_under(root):
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())


def test_extracts_kept_files_and_strips_wrapper(tmp_path):
    data = make_zip({
        "repo-main/src/a.ts": b"export const a = 1\n",
        "repo-main/node_modules/x/index.js": b"x",
        "repo-main/README.md": b"# hi",
    })
    extract_zip(data, tmp_path, Caps(BIG, 100))
    assert files_under(tmp_path) == ["src/a.ts"]


def test_project_folder_named_like_an_ignored_dir_is_kept(tmp_path):
    extract_zip(make_zip({"build/src/a.py": b"x = 1\n"}), tmp_path, Caps(BIG, 100))
    assert files_under(tmp_path) == ["src/a.py"]


@pytest.mark.parametrize("name", ["../../etc/passwd.py", "a/../../evil.py", "/etc/evil.py",
                                  "C:/evil.py", "a\\..\\evil.py"])
def test_zip_slip_rejected_before_anything_is_written(tmp_path, name):
    dest = tmp_path / "out"
    dest.mkdir()
    data = make_zip({"ok/first.py": b"x = 1\n", name: b"pwned"})
    with pytest.raises(ImportRejected):
        extract_zip(data, dest, Caps(BIG, 100))
    assert files_under(tmp_path) == []  # not even the safe entry


def test_symlink_entries_are_never_materialized(tmp_path):
    data = make_zip({"p/a.py": b"x = 1\n"}, symlinks={"p/link.py": "/etc/passwd"})
    extract_zip(data, tmp_path, Caps(BIG, 100))
    assert files_under(tmp_path) == ["a.py"]
    assert not any(p.is_symlink() for p in tmp_path.rglob("*"))


def test_size_cap_aborts_mid_extraction(tmp_path):
    # 50MB of zeros compresses to ~50KB: the archive is tiny, the payload is not.
    bomb = make_zip({"p/a.py": b"x = 1\n", "p/bomb.py": b"\0" * (50 * 1024 * 1024)})
    assert len(bomb) < 1024 * 1024
    with pytest.raises(ImportRejected, match="larger than"):
        extract_zip(bomb, tmp_path, Caps(5 * 1024 * 1024, 100))
    written = sum(p.stat().st_size for p in tmp_path.rglob("*") if p.is_file())
    assert written <= 5 * 1024 * 1024  # stopped as soon as the cap was crossed


def test_size_cap_ignores_lying_headers(tmp_path):
    data = bytearray(make_zip({"p/a.py": b"y" * 200_000}))
    # Rewrite the declared uncompressed size in the central directory to 10 bytes.
    cd = data.rfind(b"PK\x01\x02")
    data[cd + 24:cd + 28] = (10).to_bytes(4, "little")
    with pytest.raises(ImportRejected):
        extract_zip(bytes(data), tmp_path, Caps(100_000, 100))


def test_file_count_cap(tmp_path):
    data = make_zip({f"p/m{i}.py": b"x = 1\n" for i in range(11)})
    with pytest.raises(ImportRejected, match="more than 10"):
        extract_zip(data, tmp_path, Caps(BIG, 10))


def test_not_a_zip(tmp_path):
    with pytest.raises(ImportRejected, match="not a valid .zip"):
        extract_zip(b"definitely not a zip", tmp_path, Caps(BIG, 10))


@pytest.mark.parametrize("owner,repo,branch", [
    ("-oops", "r", None), ("o", "r;rm -rf", None), ("o", "r", "--upload-pack=evil"),
    ("o", "r", "a..b"), ("o", "r", "a b"),
])
def test_clone_rejects_unsafe_arguments(tmp_path, owner, repo, branch):
    with pytest.raises(ImportRejected):
        clone_github(owner, repo, branch, tmp_path / "c", Caps(BIG, 10))


def test_common_root():
    assert common_root(["r/a.py", "r/b/c.py"]) == "r"
    assert common_root(["a.py", "r/b.py"]) == ""
    assert common_root(["r/a.py", "s/b.py"]) == ""
    assert common_root([]) == ""
