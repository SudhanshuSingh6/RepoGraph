"""Resolves extracted imports to files in the same repo — the prototype's `linkFiles`
(repograph-spec.md §6). Pure: (paths, imports) in, (from_index, to_index) edges out.

Only intra-repo imports produce edges; anything that doesn't resolve to a repo file
(stdlib, third-party packages) is silently dropped.
"""

import posixpath
from collections import defaultdict
from collections.abc import Sequence
from typing import Protocol

from extract import Imports

JS_EXTS = ("js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts")  # §5.1 map order
JS_ALIAS_PREFIXES = ("@/", "~/")
JAVA_WILDCARD_CAP = 8


class SourceFile(Protocol):  # inventory.FileRecord
    path: str
    lang: str
    imports: Imports


def _dir_parts(path: str) -> list[str]:
    return path.split("/")[:-1]


def _shared_prefix(a: list[str], b: list[str]) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


class _JsResolver:
    def __init__(self, files: Sequence[SourceFile]):
        self.paths = [f.path for f in files]
        self.by_path: dict[str, int] = {}
        # Every trailing path-segment sequence of a file, with and without its extension
        # (and of its folder, for index files) → candidate files, for bare specifiers.
        self.by_suffix: dict[str, list[int]] = defaultdict(list)
        for i, f in enumerate(files):
            if f.lang not in ("js", "ts"):
                continue
            self.by_path[f.path] = i
            parts = f.path.split("/")
            stem = parts[-1].rsplit(".", 1)[0]
            keys = set()
            for k in range(len(parts)):
                keys.add("/".join(parts[k:]))
                keys.add("/".join(parts[k:-1] + [stem]))
                if stem == "index" and k < len(parts) - 1:
                    keys.add("/".join(parts[k:-1]))
            for key in keys:
                self.by_suffix[key].append(i)

    def _candidates(self, base: str) -> list[str]:
        return ([base] + [f"{base}.{e}" for e in JS_EXTS]
                + [f"{base}/index.{e}" for e in JS_EXTS])

    def resolve(self, importer: str, spec: str) -> int | None:
        if spec.startswith(("./", "../")) or spec in (".", ".."):
            joined = posixpath.normpath(posixpath.join(posixpath.dirname(importer), spec))
            if joined.startswith("../") or joined == "..":
                return None  # escapes the repo root
            for cand in self._candidates(joined):
                if cand in self.by_path:
                    return self.by_path[cand]
            return None
        # Bare specifier: an alias (`@/x`, `~/x`) or `src/...`-style path, by path suffix.
        for prefix in JS_ALIAS_PREFIXES:
            if spec.startswith(prefix):
                spec = spec[len(prefix):]
                break
        spec = spec.strip("/")
        if not spec:
            return None
        hits = self.by_suffix.get(spec)
        if not hits:
            return None
        # Prefer the candidate whose folder shares the longest path prefix with the importer.
        here = _dir_parts(importer)
        return max(hits, key=lambda i: (_shared_prefix(_dir_parts(self.paths[i]), here), -i))


class _PyResolver:
    def __init__(self, files: Sequence[SourceFile]):
        # Full dotted module path → file: a/b/c.py → a.b.c, a/b/__init__.py → a.b
        self.modules: dict[str, int] = {}
        for i, f in enumerate(files):
            if f.lang != "py":
                continue
            parts = f.path[: -len(".py")].split("/")
            if parts[-1] == "__init__":
                parts = parts[:-1]
            if parts:
                self.modules.setdefault(".".join(parts), i)

    def _shorten(self, dotted: str, floor: int) -> int | None:
        """Longest leading part of `dotted` (at least `floor` segments) that is a module."""
        parts = dotted.split(".") if dotted else []
        for n in range(len(parts), max(floor, 1) - 1, -1):
            hit = self.modules.get(".".join(parts[:n]))
            if hit is not None:
                return hit
        return None

    def resolve(self, importer: str, dots: int, module: str,
                names: tuple[str, ...]) -> list[int]:
        floor = 1
        if dots:
            # Relative: walk up the importer's folder by the dot count (`.` = its own package).
            base = _dir_parts(importer)
            up = dots - 1
            if up > len(base):
                return []
            base = base[: len(base) - up]
            floor = max(len(base), 1)
            module = ".".join(base + ([module] if module else []))
        out = []
        for name in names:  # `from pkg import submodule` imports the submodule's file
            hit = self.modules.get(f"{module}.{name}" if module else name)
            if hit is not None:
                out.append(hit)
        if len(out) < len(names) or not names:
            hit = self._shorten(module, floor)
            if hit is not None:
                out.append(hit)
        return out


class _JavaResolver:
    def __init__(self, files: Sequence[SourceFile]):
        self.classes: dict[str, int] = {}  # package.ClassName → file
        self.packages: dict[str, list[int]] = defaultdict(list)
        for i, f in enumerate(files):
            if f.lang != "java":
                continue
            stem = f.path.rsplit("/", 1)[-1][: -len(".java")]
            pkg = f.imports.java_package
            self.classes.setdefault(f"{pkg}.{stem}" if pkg else stem, i)
            self.packages[pkg or ""].append(i)

    def _shorten(self, name: str) -> int | None:
        parts = name.split(".")
        for n in range(len(parts), 0, -1):
            hit = self.classes.get(".".join(parts[:n]))
            if hit is not None:
                return hit
        return None

    def resolve(self, name: str, wildcard: bool) -> list[int]:
        if wildcard:
            members = self.packages.get(name)
            if members:
                return members[:JAVA_WILDCARD_CAP]  # avoids false positives on big packages
            # `import static a.B.*` names a class, not a package.
        hit = self._shorten(name)
        return [hit] if hit is not None else []


def link_files(files: Sequence[SourceFile]) -> list[tuple[int, int]]:
    """Resolved import edges as (importer index, imported index), deduplicated, in
    importer order, with no self-edges."""
    js = _JsResolver(files)
    py = _PyResolver(files)
    java = _JavaResolver(files)

    edges: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    for i, f in enumerate(files):
        targets: list[int] = []
        if f.lang in ("js", "ts"):
            for spec in f.imports.specifiers:
                hit = js.resolve(f.path, spec)
                if hit is not None:
                    targets.append(hit)
        elif f.lang == "py":
            for imp in f.imports.python:
                targets.extend(py.resolve(f.path, imp.dots, imp.module, imp.names))
        elif f.lang == "java":
            for imp in f.imports.java:
                targets.extend(java.resolve(imp.name, imp.wildcard))
        for t in targets:
            if t != i and (i, t) not in seen:
                seen.add((i, t))
                edges.append((i, t))
    return edges
