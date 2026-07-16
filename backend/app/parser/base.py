from dataclasses import dataclass, field


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
    module_path: str    # top-level module name
    from_module: str    # for "from X import Y", this is X
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
