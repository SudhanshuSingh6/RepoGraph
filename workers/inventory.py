"""Builds a project's file inventory from a directory on disk."""

import os
from dataclasses import dataclass
from pathlib import Path

from entities import Entity
from extract import Imports, TypeDecl, analyze_file
from filters import MAX_FILE_BYTES, is_entry_point, is_test, keep_path, lang_of


@dataclass
class FileRecord:
    path: str
    lang: str
    loc: int
    is_test: bool
    is_entry: bool
    content: str
    imports: Imports
    types: list[TypeDecl]
    entities: list[Entity]


@dataclass
class Inventory:
    files: list[FileRecord]
    skipped_large: int


def count_loc(text: str) -> int:
    """Non-blank lines (repograph-spec.md §6)."""
    return sum(1 for line in text.splitlines() if line.strip())


def process_file(rel_path: str, raw: bytes) -> FileRecord:
    """One kept file → its inventory record, with its imports, type declarations and
    ORM entities."""
    # Postgres text can't hold NUL; undecodable bytes become U+FFFD rather than failing.
    content = raw.decode("utf-8", errors="replace").replace("\x00", "")
    lang = lang_of(rel_path)
    facts = analyze_file(rel_path, lang, content)
    return FileRecord(
        path=rel_path,
        lang=lang,
        loc=count_loc(content),
        is_test=is_test(rel_path),
        is_entry=is_entry_point(rel_path, content),
        content=content,
        imports=facts.imports,
        types=facts.types,
        entities=facts.entities,
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
