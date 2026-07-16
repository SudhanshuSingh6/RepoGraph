import uuid
from pathlib import Path

from tree_sitter import Language, Parser, Node
import tree_sitter_javascript as tsjavascript
import tree_sitter_typescript as tstypescript

from .base import ParseResult, NodeData, EdgeData, CallSite, ImportRef, InheritanceRef

_JS = Language(tsjavascript.language())
_TS = Language(tstypescript.language_typescript())
_TSX = Language(tstypescript.language_tsx())

_JS_PARSER = Parser(_JS)
_TS_PARSER = Parser(_TS)
_TSX_PARSER = Parser(_TSX)

_HTTP_METHODS = {"get", "post", "put", "delete", "patch", "head", "options", "all", "use"}

_BRANCH_TYPES = {
    "if_statement", "else_clause", "for_statement", "for_in_statement",
    "while_statement", "do_statement", "switch_case", "catch_clause",
    "ternary_expression", "logical_expression",
}


def _text(node: Node | None) -> str:
    return node.text.decode("utf-8", errors="replace") if node else ""


def _count_branches(node: Node) -> int:
    count = 1 if node.type in _BRANCH_TYPES else 0
    for child in node.children:
        count += _count_branches(child)
    return count


def _get_parser(suffix: str) -> Parser:
    if suffix == ".tsx":
        return _TSX_PARSER
    if suffix in (".ts",):
        return _TS_PARSER
    return _JS_PARSER


class JavaScriptParser:
    def parse_file(self, abs_path: Path, repo_root: Path, repo_id: str) -> ParseResult:
        result = ParseResult()
        try:
            source = abs_path.read_bytes()
        except OSError:
            return result

        rel_path = str(abs_path.relative_to(repo_root))
        parser = _get_parser(abs_path.suffix)
        tree = parser.parse(source)
        root = tree.root_node

        is_ts = abs_path.suffix in (".ts", ".tsx")
        lang_label = "TypeScript" if is_ts else "JavaScript"

        file_id = str(uuid.uuid4())
        file_node = NodeData(
            id=file_id, type="File", name=abs_path.name,
            repo_id=repo_id, file_path=rel_path,
            start_line=1, end_line=source.count(b"\n") + 1,
            properties={"language": lang_label},
        )
        result.nodes.append(file_node)
        self._walk_program(root, rel_path, file_id, repo_id, result)
        return result

    def _walk_program(
        self, node: Node, file_path: str, file_id: str, repo_id: str, result: ParseResult
    ) -> None:
        for child in node.named_children:
            self._handle_stmt(child, file_path, file_id, None, repo_id, result)

    def _handle_stmt(
        self, node: Node, file_path: str, file_id: str,
        parent_class: NodeData | None, repo_id: str, result: ParseResult
    ) -> None:
        t = node.type
        if t == "class_declaration":
            self._extract_class(node, file_path, file_id, repo_id, result)
        elif t in ("function_declaration", "generator_function_declaration"):
            self._extract_function(node, file_path, file_id, parent_class, repo_id, result)
        elif t == "import_statement":
            self._extract_import(node, file_id, result)
        elif t in ("lexical_declaration", "variable_declaration"):
            # Look for arrow functions or REST calls assigned to variables
            for child in node.named_children:
                if child.type == "variable_declarator":
                    val = child.child_by_field_name("value")
                    if val and val.type in ("arrow_function", "function"):
                        self._extract_function(
                            val, file_path, file_id, parent_class, repo_id, result,
                            name_node=child.child_by_field_name("name"),
                        )
        elif t == "expression_statement":
            # router.get('/path', handler) at top level
            for child in node.named_children:
                if child.type == "call_expression":
                    self._try_rest_call(child, file_id, file_path, repo_id, result)

    def _extract_class(
        self, node: Node, file_path: str, file_id: str, repo_id: str, result: ParseResult
    ) -> NodeData | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        class_id = str(uuid.uuid4())
        class_node = NodeData(
            id=class_id, type="Class", name=_text(name_node),
            repo_id=repo_id, file_path=file_path,
            start_line=node.start_point[0] + 1, end_line=node.end_point[0] + 1,
        )
        result.nodes.append(class_node)
        result.edges.append(EdgeData(source_id=file_id, target_id=class_id, type="CONTAINS"))

        # extends
        heritage = node.child_by_field_name("class_heritage")
        if heritage:
            for h in heritage.named_children:
                if h.type == "identifier":
                    result.inheritance_refs.append(InheritanceRef(
                        child_node_id=class_id, parent_name=_text(h), ref_type="EXTENDS"
                    ))

        # implements (TypeScript)
        for child in node.named_children:
            if child.type == "implements_clause":
                for impl in child.named_children:
                    if impl.type in ("type_identifier", "identifier"):
                        result.inheritance_refs.append(InheritanceRef(
                            child_node_id=class_id, parent_name=_text(impl), ref_type="IMPLEMENTS"
                        ))

        body = node.child_by_field_name("body")
        if body:
            for child in body.named_children:
                if child.type == "method_definition":
                    self._extract_method(child, file_path, file_id, class_node, repo_id, result)

        return class_node

    def _extract_function(
        self, node: Node, file_path: str, file_id: str,
        parent_class: NodeData | None, repo_id: str, result: ParseResult,
        name_node: Node | None = None,
    ) -> NodeData | None:
        n_node = name_node or node.child_by_field_name("name")
        name = _text(n_node) if n_node else "<anonymous>"

        body = node.child_by_field_name("body")
        complexity = 1 + (_count_branches(body) if body else 0)

        mid = str(uuid.uuid4())
        method_node = NodeData(
            id=mid, type="Method", name=name,
            repo_id=repo_id, file_path=file_path,
            start_line=node.start_point[0] + 1, end_line=node.end_point[0] + 1,
            properties={"complexity": complexity, "lines": node.end_point[0] - node.start_point[0] + 1},
        )
        result.nodes.append(method_node)
        parent_id = parent_class.id if parent_class else file_id
        result.edges.append(EdgeData(source_id=parent_id, target_id=mid, type="CONTAINS"))
        if body:
            self._collect_calls(body, mid, result)
        return method_node

    def _extract_method(
        self, node: Node, file_path: str, file_id: str,
        parent_class: NodeData | None, repo_id: str, result: ParseResult
    ) -> NodeData | None:
        name_node = node.child_by_field_name("name")
        body = node.child_by_field_name("body")
        complexity = 1 + (_count_branches(body) if body else 0)

        mid = str(uuid.uuid4())
        method_node = NodeData(
            id=mid, type="Method", name=_text(name_node),
            repo_id=repo_id, file_path=file_path,
            start_line=node.start_point[0] + 1, end_line=node.end_point[0] + 1,
            properties={"complexity": complexity, "lines": node.end_point[0] - node.start_point[0] + 1},
        )
        result.nodes.append(method_node)
        parent_id = parent_class.id if parent_class else file_id
        result.edges.append(EdgeData(source_id=parent_id, target_id=mid, type="CONTAINS"))
        if body:
            self._collect_calls(body, mid, result)
        return method_node

    def _collect_calls(self, node: Node, caller_id: str, result: ParseResult) -> None:
        if node.type == "call_expression":
            func = node.child_by_field_name("function")
            if func:
                callee, obj = self._parse_call_target(func)
                if callee:
                    result.call_sites.append(
                        CallSite(caller_node_id=caller_id, callee_name=callee, callee_object=obj)
                    )
        for child in node.children:
            if child.type not in ("function", "arrow_function", "class"):
                self._collect_calls(child, caller_id, result)

    def _parse_call_target(self, node: Node) -> tuple[str, str]:
        if node.type in ("identifier", "type_identifier"):
            return _text(node), ""
        if node.type == "member_expression":
            obj = node.child_by_field_name("object")
            prop = node.child_by_field_name("property")
            return _text(prop), _text(obj)
        return "", ""

    def _try_rest_call(
        self, node: Node, file_id: str, file_path: str, repo_id: str, result: ParseResult
    ) -> None:
        func = node.child_by_field_name("function")
        args = node.child_by_field_name("arguments")
        if not func or func.type != "member_expression":
            return
        prop = func.child_by_field_name("property")
        method_name = _text(prop).lower()
        if method_name not in _HTTP_METHODS:
            return

        path = ""
        handler_name = ""
        if args:
            children = [c for c in args.named_children]
            if children and children[0].type == "string":
                path = _text(children[0]).strip("'\"`")
            if len(children) > 1 and children[-1].type == "identifier":
                handler_name = _text(children[-1])

        ep_id = str(uuid.uuid4())
        ep_node = NodeData(
            id=ep_id, type="RestEndpoint",
            name=f"{method_name.upper()} {path}",
            repo_id=repo_id, file_path=file_path,
            start_line=node.start_point[0] + 1, end_line=node.end_point[0] + 1,
            properties={"http_method": method_name.upper(), "path": path},
        )
        result.nodes.append(ep_node)
        result.edges.append(EdgeData(source_id=file_id, target_id=ep_id, type="EXPOSES_ENDPOINT"))

        if handler_name:
            result.call_sites.append(
                CallSite(caller_node_id=ep_id, callee_name=handler_name, callee_object="")
            )

    def _extract_import(self, node: Node, file_id: str, result: ParseResult) -> None:
        source_node = node.child_by_field_name("source")
        specifier = _text(source_node).strip("'\"`") if source_node else ""
        if not specifier:
            return

        imported: list[str] = []
        for child in node.named_children:
            if child.type == "import_clause":
                for c in child.named_children:
                    if c.type == "identifier":
                        imported.append(_text(c))
                    elif c.type == "named_imports":
                        for item in c.named_children:
                            if item.type == "import_specifier":
                                n = item.child_by_field_name("name")
                                imported.append(_text(n) if n else "")
                    elif c.type == "namespace_import":
                        imported.append("*")

        result.import_refs.append(ImportRef(
            file_node_id=file_id,
            module_path=specifier,
            from_module=specifier,
            imported_names=imported,
            is_relative=specifier.startswith("."),
        ))
