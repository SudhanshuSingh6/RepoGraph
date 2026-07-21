from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class NodeData:
    id: str
    type: str  # Package, File, Class, Interface, Enum, Method, RestEndpoint, ExternalLib
    name: str
    repo_id: str
    file_path: str
    start_line: int = 0
    end_line: int = 0
    properties: dict = field(default_factory=dict)


@dataclass
class EdgeData:
    source_id: str
    target_id: str
    type: str  # CONTAINS, IMPORTS, CALLS, EXTENDS, IMPLEMENTS, EXPOSES_ENDPOINT, DEPENDS_ON


@dataclass
class CallSite:
    caller_node_id: str
    callee_name: str
    callee_object: str = ""  # non-empty for obj.method() calls


@dataclass
class ImportRef:
    file_node_id: str
    module_path: str  # top-level module name
    from_module: str  # for "from X import Y", this is X
    imported_names: list[str]
    is_relative: bool = False


@dataclass
class InheritanceRef:
    child_node_id: str
    parent_name: str
    ref_type: str  # "EXTENDS" or "IMPLEMENTS"


@dataclass
class ParseResult:
    nodes: list[NodeData] = field(default_factory=list)
    edges: list[EdgeData] = field(default_factory=list)
    call_sites: list[CallSite] = field(default_factory=list)
    import_refs: list[ImportRef] = field(default_factory=list)
    inheritance_refs: list[InheritanceRef] = field(default_factory=list)


# ── Architectural role classification ─────────────────────────────────────────

_ROLE_SUFFIXES: dict[str, tuple[str, ...]] = {
    "Controller": ("Controller", "Resource", "Handler", "Endpoint", "Router"),
    "Service": ("Service", "Manager", "Facade", "UseCase", "Context"),
    "Repository": ("Repository", "Repo", "Dao", "Store", "Mapper", "Adapter"),
    "Model": ("Model", "Entity", "Schema", "Dto", "ViewModel"),
    "Middleware": ("Middleware", "Interceptor", "Guard", "Filter", "Pipe"),
    "Configuration": ("Config", "Configuration", "Module", "Settings", "Factory"),
    "Utility": ("Util", "Utils", "Helper", "Helpers", "Builder", "Formatter"),
}

_PATH_ROLES: dict[str, tuple[str, ...]] = {
    "Controller": ("controllers", "routes", "routers", "views", "pages", "endpoints"),
    "Service": ("services", "contexts"),
    "Repository": ("repositories", "dao", "db", "models", "store", "redux", "slices"),
    "Middleware": ("middleware", "interceptors", "guards", "filters", "pipes"),
    "Configuration": ("config", "configurations", "settings"),
    "Utility": ("utils", "helpers", "lib", "shared", "common", "hooks"),
}


def classify_role(name: str, file_path: str) -> str | None:
    """Infer an architectural role from the class name (suffix) or file path."""
    for role, suffixes in _ROLE_SUFFIXES.items():
        if any(name.endswith(s) for s in suffixes):
            return role
    parts = set(Path(file_path).parts)
    for role, segments in _PATH_ROLES.items():
        if parts & set(segments):
            return role
    return None
