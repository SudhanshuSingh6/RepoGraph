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
