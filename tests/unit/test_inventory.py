import json
from pathlib import Path

from filters import MAX_FILE_BYTES
from inventory import build_inventory, count_loc
from resolve import link_files

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "sample-project"
SAMPLE_EDGES = {tuple(e) for e in
                json.loads((ROOT / "tests/fixtures/sample-edges.json").read_text())["edges"]}


def write(root: Path, rel: str, data: bytes):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def test_count_loc_skips_blank_lines():
    assert count_loc("a\n\n  \nb\n\t\nc") == 3
    assert count_loc("") == 0


def test_inventory_records(tmp_path):
    write(tmp_path, "src/a.ts", b"import x from './b'\n\nexport {}\n")
    write(tmp_path, "src/a.test.ts", b"test()\n")
    write(tmp_path, "node_modules/x.js", b"x\n")
    write(tmp_path, "notes.md", b"# no\n")
    inv = build_inventory(tmp_path)
    by_path = {f.path: f for f in inv.files}
    assert sorted(by_path) == ["src/a.test.ts", "src/a.ts"]
    assert by_path["src/a.ts"].lang == "ts"
    assert by_path["src/a.ts"].loc == 2
    assert not by_path["src/a.ts"].is_test
    assert by_path["src/a.test.ts"].is_test
    assert inv.skipped_large == 0


def test_oversized_files_are_counted_not_read(tmp_path):
    write(tmp_path, "big.js", b"x\n" * (MAX_FILE_BYTES // 2 + 1))
    write(tmp_path, "small.js", b"y\n")
    inv = build_inventory(tmp_path)
    assert [f.path for f in inv.files] == ["small.js"]
    assert inv.skipped_large == 1


def test_content_is_postgres_safe(tmp_path):
    write(tmp_path, "a.py", b"x = 1\x00\nb = '\xff'\n")
    (f,) = build_inventory(tmp_path).files
    assert "\x00" not in f.content
    assert "�" in f.content


def test_symlinks_are_skipped(tmp_path):
    write(tmp_path, "real.py", b"x = 1\n")
    (tmp_path / "link.py").symlink_to(tmp_path / "real.py")
    assert [f.path for f in build_inventory(tmp_path).files] == ["real.py"]


def test_sample_project_inventory():
    inv = build_inventory(FIXTURE)
    langs = {}
    for f in inv.files:
        langs[f.lang] = langs.get(f.lang, 0) + 1
    assert set(langs) == {"java", "js", "ts", "py"}
    assert sum(langs.values()) == len(inv.files)
    assert any(f.is_test for f in inv.files)


def test_sample_project_import_edges():
    """The fixture's known graph (fixtures/sample-project/README.md), including the
    store → render → format → store cycle."""
    inv = build_inventory(FIXTURE)
    got = {(inv.files[a].path, inv.files[b].path) for a, b in link_files(inv.files)}
    assert got == SAMPLE_EDGES

