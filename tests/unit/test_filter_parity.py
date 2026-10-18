"""The browser's copy of keepPath (src/lib/import/filters.ts) is tested against the
same cases in src/lib/import/filters.spec.ts."""

import json
from pathlib import Path

import pytest

from filters import keep_path

CASES = json.loads((Path(__file__).parents[1] / "fixtures" / "filter-cases.json").read_text())


@pytest.mark.parametrize("path", CASES["kept"])
def test_kept(path):
    assert keep_path(path)


@pytest.mark.parametrize("path", CASES["dropped"])
def test_dropped(path):
    assert not keep_path(path)
