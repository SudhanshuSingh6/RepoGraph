"""Builds a project's file inventory from a directory on disk."""

import os
from dataclasses import dataclass
from pathlib import Path

from extract import Imports, extract_imports
from filters import MAX_FILE_BYTES, is_test, keep_path, lang_of


@dataclass
class FileRecord:
    path: str
    lang: str
    loc: int
    is_test: bool
    content: str
    imports: Imports


@dataclass
class Inventory:
    files: list[FileRecord]
    skipped_large: int


def count_loc(text: str) -> int:
    """Non-blank lines (repograph-spec.md §6)."""
    return sum(1 for line in text.splitlines() if line.strip())


def process_file(rel_path: str, raw: bytes) -> FileRecord:
    """One kept file → its inventory record, with its imports (Phase 6 adds types here)."""
    # Postgres text can't hold NUL; undecodable bytes become U+FFFD rather than failing.
    content = raw.decode("utf-8", errors="replace").replace("\x00", "")
    lang = lang_of(rel_path)
    return FileRecord(
        path=rel_path,
        lang=lang,
        loc=count_loc(content),
        is_test=is_test(rel_path),
        content=content,
        imports=extract_imports(rel_path, lang, content),
    )


def build_inventory(root: Path) -> Inventory:
    candidates: list[tuple[str, Path]] = []
    for dirpath, dirs, files in os.walk(root):  # never follows symlinked dirs
        dirs.sort()
        for name in sorted(files):
            p = Path(dirpath, name)
            if p.is_symlink():
                continue
            rel = p.relative_to(root).as_posix()
            if keep_path(rel):
                candidates.append((rel, p))

    records: list[FileRecord] = []
    skipped_large = 0
    for rel, p in candidates:
        if p.stat().st_size > MAX_FILE_BYTES:
            skipped_large += 1
            continue
        records.append(process_file(rel, p.read_bytes()))
    return Inventory(files=records, skipped_large=skipped_large)
