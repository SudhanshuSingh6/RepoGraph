from pathlib import Path

from .base import ImportRef, NodeData


class SymbolTable:
    def __init__(self, repo_root: Path):
        self._repo_root = repo_root
        self._qualified: dict[str, NodeData] = {}  # "file_path::name" -> node
        self._bare: dict[str, list[NodeData]] = {}  # "name" -> [nodes...]
        self._files: dict[str, NodeData] = {}  # rel_path -> File node

    def add(self, node: NodeData) -> None:
        key = f"{node.file_path}::{node.name}"
        self._qualified[key] = node
        self._bare.setdefault(node.name, []).append(node)
        if node.type == "File":
            self._files[node.file_path] = node

    def get_file(self, rel_path: str) -> NodeData | None:
        return self._files.get(rel_path)

    def resolve_by_file_and_name(self, file_path: str, name: str) -> NodeData | None:
        return self._qualified.get(f"{file_path}::{name}")

    def resolve_by_name(self, name: str, prefer_type: str = "") -> list[NodeData]:
        nodes = self._bare.get(name, [])
        if prefer_type:
            typed = [n for n in nodes if n.type == prefer_type]
            return typed if typed else nodes
        return nodes

    def resolve_python_import(self, importer_path: str, ref: ImportRef) -> str | None:
        """Return repo-relative file path if import resolves locally, else None."""
        module = ref.from_module or ref.module_path
        importer = Path(importer_path)

        if ref.is_relative:
            dots = len(module) - len(module.lstrip("."))
            base = importer.parent
            for _ in range(dots - 1):
                base = base.parent
            remainder = module.lstrip(".")
            if not remainder:
                # "from . import foo" — check each imported name as a module
                for name in ref.imported_names:
                    for suf in [f"{name}.py", f"{name}/__init__.py"]:
                        if (self._repo_root / base / suf).exists():
                            return str(base / suf)
                return None
            parts = remainder.replace(".", "/")
            candidates = [base / f"{parts}.py", base / parts / "__init__.py"]
        else:
            parts = module.replace(".", "/")
            candidates = [Path(f"{parts}.py"), Path(f"{parts}/__init__.py")]

        for c in candidates:
            if (self._repo_root / c).exists():
                return str(c)
        return None

    def resolve_js_import(self, importer_path: str, specifier: str) -> str | None:
        """Resolve JS/TS import specifier to a repo-relative path."""
        if not specifier.startswith("."):
            return None  # external package
        base = Path(importer_path).parent
        raw = (base / specifier).as_posix()
        extensions = [".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.ts"]
        for ext in extensions:
            candidate = Path(raw + ext)
            if (self._repo_root / candidate).exists():
                return str(candidate)
            candidate2 = Path(raw) / f"index{ext.lstrip('/')}"
            if (self._repo_root / candidate2).exists():
                return str(candidate2)
        return None

    def resolve_java_import(self, fqn: str) -> str | None:
        """Resolve Java fully-qualified import to a repo-relative .java file."""
        path = fqn.replace(".", "/") + ".java"
        if (self._repo_root / path).exists():
            return path
        # Search recursively (common when source root is src/main/java/...)
        for f in self._repo_root.rglob(f"{fqn.rsplit('.', 1)[-1]}.java"):
            return str(f.relative_to(self._repo_root))
        return None
