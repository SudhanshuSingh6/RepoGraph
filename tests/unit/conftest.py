import pytest

from inventory import process_file
from resolve import link_files


def resolve_edges(files: dict[str, str]) -> set[tuple[str, str]]:
    """{path: source} → resolved import edges as (importer path, imported path)."""
    records = [process_file(path, src.encode()) for path, src in files.items()]
    return {(records[a].path, records[b].path) for a, b in link_files(records)}


@pytest.fixture
def edges():
    return resolve_edges


def link(files: dict[str, str]):
    """{path: source} → (per-path parsed_flows row, Linker) for the APIs-view tests."""
    from flow_link import Linker, link_flows
    records = [process_file(path, src.encode()) for path, src in files.items()]
    rows = link_flows(records, [r.types for r in records])
    return {r.path: row for r, row in zip(records, rows)}, Linker(records, [r.types for r in records])


def endpoints_of(files: dict[str, str]) -> list[tuple[str, str, str]]:
    """{path: source} → sorted (method, path, prefix status) for every endpoint."""
    rows, _ = link(files)
    return sorted((e["method"], e["path"], e["prefix"])
                  for row in rows.values() for e in row.get("endpoints", []))


@pytest.fixture
def flows():
    return link


@pytest.fixture
def endpoints():
    return endpoints_of
