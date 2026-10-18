"""File filtering rules, ported exactly from repograph-spec.md §5.1."""

import re
from pathlib import PurePosixPath

EXT_LANG = {
    "java": "java",
    "js": "js", "jsx": "js", "mjs": "js", "cjs": "js",
    "ts": "ts", "tsx": "ts", "mts": "ts", "cts": "ts",
    "py": "py",
}

IGNORED_DIRS = frozenset({
    "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
    "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache",
    ".ruff_cache", ".idea", ".vscode", "coverage", ".next", ".nuxt", ".gradle",
    ".mvn", "bower_components", "site-packages", ".cache", ".turbo", ".angular",
    ".svelte-kit",
})

# *.d.ts/*.d.mts/*.d.cts, *.min.js (and .mjs/.cjs), *.bundle.js
EXCLUDED_FILE = re.compile(r"\.d\.(ts|mts|cts)$|\.min\.(js|mjs|cjs)$|\.bundle\.js$", re.I)

# Oversized files are counted but not read.
MAX_FILE_BYTES = 1_500_000

TEST_PATH = re.compile(
    r"(^|/)(tests?|__tests__|specs?|e2e|__mocks__)/"
    r"|\.(test|spec)\.[^/]+$"
    r"|(^|/)test_[^/]*\.py$"
    r"|_test\.py$"
    r"|(^|/)conftest\.py$"
    r"|(^|/)src/test/"
    r"|(Test|Tests|IT)\.java$"
)

ENTRY_BASENAME = re.compile(
    r"^(index|main|__init__|__main__|app|application|wsgi|asgi|manage|setup|conftest)"
    r"\.(java|js|jsx|mjs|cjs|ts|tsx|mts|cts|py)$",
    re.I,
)
PY_MAIN_GUARD = re.compile(r"""if\s+__name__\s*==\s*['"]__main__['"]""")


def lang_of(path: str) -> str | None:
    name = PurePosixPath(path).name
    if "." not in name:
        return None
    return EXT_LANG.get(name.rsplit(".", 1)[1].lower())


def keep_path(path: str) -> bool:
    """Ignore-list + extension check (the prototype's keepPath)."""
    parts = PurePosixPath(path).parts
    if not parts or any(p in IGNORED_DIRS for p in parts[:-1]):
        return False
    if EXCLUDED_FILE.search(parts[-1]):
        return False
    return lang_of(path) is not None


def is_test(path: str) -> bool:
    return bool(TEST_PATH.search(path))


def is_entry_point(path: str, content: str | None) -> bool:
    """Excludes a file from "possibly unused" (used from Phase 7)."""
    name = PurePosixPath(path).name
    if ENTRY_BASENAME.match(name) or name.endswith("Application.java"):
        return True
    return name.endswith(".py") and content is not None and bool(PY_MAIN_GUARD.search(content))
