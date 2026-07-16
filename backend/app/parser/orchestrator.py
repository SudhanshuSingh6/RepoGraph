"""
Two-pass repo orchestrator.

Pass 1  — parse every file → collect nodes/edges/call-sites/import-refs.
Pass 2  — resolve imports, calls, extends/implements → cross-file edges.
"""
import logging
import uuid
from pathlib import Path

from neo4j import AsyncDriver

from app.ingestion.language import IGNORE_DIRS, IGNORE_SUFFIXES
from app.graph.builder import write_nodes, write_edges
from .base import NodeData, EdgeData, ImportRef, ParseResult
from .symbol_table import SymbolTable
from .python_parser import PythonParser
from .js_parser import JavaScriptParser
from .java_parser import JavaParser

log = logging.getLogger(__name__)

_EXT_MAP: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".java": "java",
}

_PARSERS = {
    "python": PythonParser(),
    "javascript": JavaScriptParser(),
    "typescript": JavaScriptParser(),
    "java": JavaParser(),
}


def _is_ignored(rel_path: Path) -> bool:
    return any(part in IGNORE_DIRS for part in rel_path.parts) or \
           any(rel_path.name.endswith(s) for s in IGNORE_SUFFIXES)


def _collect_files(repo_root: Path) -> list[Path]:
    files = []
    for f in repo_root.rglob("*"):
        if not f.is_file():
            continue
        rel = f.relative_to(repo_root)
        if _is_ignored(rel):
            continue
        if f.suffix.lower() in _EXT_MAP:
            files.append(f)
    return files


class RepoOrchestrator:
    def __init__(self, repo_id: str, repo_root: Path):
        self.repo_id = repo_id
        self.repo_root = repo_root

    async def run(self, driver: AsyncDriver, on_progress=None) -> None:
        files = _collect_files(self.repo_root)
        if not files:
            log.warning("repo %s: no parseable files found", self.repo_id)
            return

        # ── Pass 1: parse files, build symbol table ────────────────────
        results: dict[str, ParseResult] = {}
        symbol_table = SymbolTable(self.repo_root)

        # Package nodes (one per unique directory)
        package_ids: dict[str, str] = {}  # rel_dir_str -> node_id
        all_nodes: list[NodeData] = []

        for i, abs_path in enumerate(files):
            rel = abs_path.relative_to(self.repo_root)
            lang_key = _EXT_MAP.get(abs_path.suffix.lower(), "")
            parser = _PARSERS.get(lang_key)
            if not parser:
                continue

            # Ensure Package node for each ancestor directory
            for ancestor in list(rel.parents)[:-1]:  # skip root "."
                astr = str(ancestor)
                if astr not in package_ids:
                    pid = str(uuid.uuid4())
                    package_ids[astr] = pid
                    pkg_node = NodeData(
                        id=pid, type="Package",
                        name=ancestor.name,
                        repo_id=self.repo_id,
                        file_path=astr,
                    )
                    all_nodes.append(pkg_node)
                    symbol_table.add(pkg_node)

            try:
                res = parser.parse_file(abs_path, self.repo_root, self.repo_id)
            except Exception as exc:
                log.warning("parse error %s: %s", rel, exc)
                continue

            results[str(rel)] = res
            for node in res.nodes:
                symbol_table.add(node)

            if on_progress:
                on_progress(i + 1, len(files))

        # ── Collect pass-1 edges: Package→File CONTAINS ────────────────
        pkg_file_edges: list[EdgeData] = []
        for rel_path_str, res in results.items():
            rel = Path(rel_path_str)
            file_node = next((n for n in res.nodes if n.type == "File"), None)
            if not file_node:
                continue

            # Find nearest package
            for ancestor in list(rel.parents)[:-1]:
                astr = str(ancestor)
                if astr in package_ids:
                    pkg_file_edges.append(EdgeData(
                        source_id=package_ids[astr],
                        target_id=file_node.id,
                        type="CONTAINS",
                    ))
                    break

        # ── Pass 2: cross-file resolution ──────────────────────────────
        cross_edges = self._resolve_cross_file(results, symbol_table)

        # ── Write to Neo4j ─────────────────────────────────────────────
        all_file_nodes = [n for res in results.values() for n in res.nodes]
        all_nodes.extend(all_file_nodes)

        all_edges = (
            [e for res in results.values() for e in res.edges]
            + pkg_file_edges
            + cross_edges
        )

        await write_nodes(driver, all_nodes)
        await write_edges(driver, all_edges)

    # ──────────────────────────────────────────────────────────────────
    #  Cross-file resolution
    # ──────────────────────────────────────────────────────────────────

    def _resolve_cross_file(
        self, results: dict[str, ParseResult], st: SymbolTable
    ) -> list[EdgeData]:
        edges: list[EdgeData] = []

        # snapshot: the loop body may insert the "__external__" key into results
        for file_path, res in list(results.items()):
            lang = self._detect_lang(file_path)
            file_node = next((n for n in res.nodes if n.type == "File"), None)
            if not file_node:
                continue

            # ── Import resolution ──────────────────────────────────────
            for ref in res.import_refs:
                local_path = self._resolve_import(file_path, ref, lang, st)
                if local_path:
                    target_file = st.get_file(local_path)
                    if target_file:
                        edges.append(EdgeData(
                            source_id=ref.file_node_id,
                            target_id=target_file.id,
                            type="IMPORTS",
                        ))
                else:
                    # ExternalLib node — deduplicate by module name
                    top = ref.module_path.split(".")[0].split("/")[0]
                    existing = st.resolve_by_name(top, prefer_type="ExternalLib")
                    if existing:
                        lib_id = existing[0].id
                    else:
                        lib_id = str(uuid.uuid4())
                        lib_node = NodeData(
                            id=lib_id, type="ExternalLib", name=top,
                            repo_id=self.repo_id, file_path="",
                        )
                        st.add(lib_node)
                        # Write lib node inline — small, add to results
                        results.setdefault("__external__", ParseResult()).nodes.append(lib_node)
                    edges.append(EdgeData(
                        source_id=ref.file_node_id,
                        target_id=lib_id,
                        type="IMPORTS",
                    ))

            # ── EXTENDS / IMPLEMENTS resolution ───────────────────────
            for iref in res.inheritance_refs:
                targets = st.resolve_by_name(
                    iref.parent_name,
                    prefer_type="Interface" if iref.ref_type == "IMPLEMENTS" else "Class",
                )
                for tgt in targets[:1]:  # take best match
                    edges.append(EdgeData(
                        source_id=iref.child_node_id,
                        target_id=tgt.id,
                        type=iref.ref_type,
                    ))

            # ── CALLS resolution ──────────────────────────────────────
            for cs in res.call_sites:
                targets = st.resolve_by_name(cs.callee_name, prefer_type="Method")
                for tgt in targets[:3]:  # cap fan-out
                    if tgt.file_path != file_path:  # cross-file only
                        edges.append(EdgeData(
                            source_id=cs.caller_node_id,
                            target_id=tgt.id,
                            type="CALLS",
                        ))

        return edges

    def _resolve_import(
        self, file_path: str, ref: ImportRef, lang: str, st: SymbolTable
    ) -> str | None:
        if lang == "python":
            return st.resolve_python_import(file_path, ref)
        if lang in ("javascript", "typescript"):
            specifier = ref.from_module or ref.module_path
            return st.resolve_js_import(file_path, specifier)
        if lang == "java":
            return st.resolve_java_import(ref.module_path)
        return None

    @staticmethod
    def _detect_lang(file_path: str) -> str:
        ext = Path(file_path).suffix.lower()
        return _EXT_MAP.get(ext, "")
