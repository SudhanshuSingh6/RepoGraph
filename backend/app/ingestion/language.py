from pathlib import Path

IGNORE_DIRS = {
    "node_modules", ".git", "dist", "build", "__pycache__",
    "vendor", ".venv", "venv", ".tox", "coverage", ".nyc_output",
}

IGNORE_SUFFIXES = {".min.js", ".min.css", ".map", ".lock"}

_EXT_TO_LANG: dict[str, str] = {
    ".py": "Python",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".java": "Java",
}


def _is_ignored(path: Path) -> bool:
    return any(part in IGNORE_DIRS for part in path.parts)


def detect_language(root: Path) -> dict:
    """Walk root and return primary language + per-language byte breakdown."""
    byte_counts: dict[str, int] = {}

    for file in root.rglob("*"):
        if not file.is_file():
            continue
        if _is_ignored(file.relative_to(root)):
            continue
        if any(file.name.endswith(s) for s in IGNORE_SUFFIXES):
            continue

        lang = _EXT_TO_LANG.get(file.suffix.lower())
        if lang is None:
            continue

        try:
            size = file.stat().st_size
        except OSError:
            continue

        byte_counts[lang] = byte_counts.get(lang, 0) + size

    if not byte_counts:
        return {"primary": "Unknown", "breakdown": {}}

    total = sum(byte_counts.values())
    breakdown = {lang: round(count / total, 3) for lang, count in byte_counts.items()}
    primary = max(byte_counts, key=byte_counts.__getitem__)

    return {"primary": primary, "breakdown": breakdown}
