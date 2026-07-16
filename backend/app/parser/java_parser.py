import uuid
from pathlib import Path

from tree_sitter import Language, Parser, Node
import tree_sitter_java as tsjava

from .base import ParseResult, NodeData, EdgeData, CallSite, ImportRef, InheritanceRef

_LANGUAGE = Language(tsjava.language())
_PARSER = Parser(_LANGUAGE)

_HTTP_ANNOTATIONS = {
    "GetMapping", "PostMapping", "PutMapping", "DeleteMapping",
    "PatchMapping", "RequestMapping",
}
_ANNOTATION_TO_VERB = {
    "GetMapping": "GET", "PostMapping": "POST", "PutMapping": "PUT",
    "DeleteMapping": "DELETE", "PatchMapping": "PATCH", "RequestMapping": "ANY",
}

_BRANCH_TYPES = {
    "if_statement", "else", "for_statement", "enhanced_for_statement",
    "while_statement", "do_statement", "switch_label", "catch_clause",
    "ternary_expression", "binary_expression",
}


def _text(node: Node | None) -> str:
    return node.text.decode("utf-8", errors="replace") if node else ""


def _count_branches(node: Node) -> int:
    count = 1 if node.type in _BRANCH_TYPES else 0
    for child in node.children:
        count += _count_branches(child)
    return count


def _get_annotations(node: Node) -> list[str]:
    annotations = []
    for child in node.named_children:
        if child.type == "modifiers":
            for mod in child.named_children:
                if mod.type == "annotation":
                    name = mod.child_by_field_name("name")
                    annotations.append(_text(name))
    return annotations


class JavaParser:
    def parse_file(self, abs_path: Path, repo_root: Path, repo_id: str) -> ParseResult:
        result = ParseResult()
        try:
            source = abs_path.read_bytes()
        except OSError:
            return result

        rel_path = str(abs_path.relative_to(repo_root))
        tree = _PARSER.parse(source)
        root = tree.root_node

        file_id = str(uuid.uuid4())
        file_node = NodeData(
            id=file_id, type="File", name=abs_path.name,
            repo_id=repo_id, file_path=rel_path,
            start_line=1, end_line=source.count(b"\n") + 1,
            properties={"language": "Java"},
        )
        result.nodes.append(file_node)
        self._walk_program(root, rel_path, file_id, repo_id, result)
        return result

    def _walk_program(
        self, node: Node, file_path: str, file_id: str, repo_id: str, result: ParseResult
    ) -> None:
        for child in node.named_children:
            t = child.type
            if t == "import_declaration":
                self._extract_import(child, file_id, result)
            elif t == "class_declaration":
                self._extract_class(child, file_path, file_id, repo_id, result, node_type="Class")
            elif t == "interface_declaration":
                self._extract_class(child, file_path, file_id, repo_id, result, node_type="Interface")
            elif t == "enum_declaration":
                self._extract_enum(child, file_path, file_id, repo_id, result)

    def _extract_class(
        self, node: Node, file_path: str, file_id: str,
        repo_id: str, result: ParseResult, node_type: str = "Class"
    ) -> NodeData | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        class_id = str(uuid.uuid4())
        class_node = NodeData(
            id=class_id, type=node_type, name=_text(name_node),
            repo_id=repo_id, file_path=file_path,
            start_line=node.start_point[0] + 1, end_line=node.end_point[0] + 1,
        )
        result.nodes.append(class_node)
        result.edges.append(EdgeData(source_id=file_id, target_id=class_id, type="CONTAINS"))

        # extends
        superclass = node.child_by_field_name("superclass")
        if superclass:
            for c in superclass.named_children:
                if c.type == "type_identifier":
                    result.inheritance_refs.append(InheritanceRef(
                        child_node_id=class_id, parent_name=_text(c), ref_type="EXTENDS"
                    ))

        # implements
        interfaces = node.child_by_field_name("interfaces")
        if interfaces:
            for c in interfaces.named_children:
                if c.type == "type_identifier":
                    result.inheritance_refs.append(InheritanceRef(
                        child_node_id=class_id, parent_name=_text(c), ref_type="IMPLEMENTS"
                    ))

        body = node.child_by_field_name("body")
        if body:
            for child in body.named_children:
                t = child.type
                if t == "method_declaration":
                    self._extract_method(child, file_path, file_id, class_node, repo_id, result)
                elif t == "constructor_declaration":
                    self._extract_method(child, file_path, file_id, class_node, repo_id, result)
                elif t in ("class_declaration", "interface_declaration"):
                    self._extract_class(child, file_path, file_id, repo_id, result, node_type)

        return class_node

    def _extract_enum(
        self, node: Node, file_path: str, file_id: str, repo_id: str, result: ParseResult
    ) -> None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return
        eid = str(uuid.uuid4())
        enum_node = NodeData(
            id=eid, type="Enum", name=_text(name_node),
            repo_id=repo_id, file_path=file_path,
            start_line=node.start_point[0] + 1, end_line=node.end_point[0] + 1,
        )
        result.nodes.append(enum_node)
        result.edges.append(EdgeData(source_id=file_id, target_id=eid, type="CONTAINS"))

    def _extract_method(
        self, node: Node, file_path: str, file_id: str,
        parent_class: NodeData | None, repo_id: str, result: ParseResult
    ) -> NodeData | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        annotations = _get_annotations(node)
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

        # REST endpoint via annotation
        for ann in annotations:
            if ann in _HTTP_ANNOTATIONS:
                self._create_rest_endpoint(node, ann, method_node, file_id, file_path, repo_id, result)

        if body:
            self._collect_calls(body, mid, result)

        return method_node

    def _create_rest_endpoint(
        self, method_node_ast: Node, annotation: str,
        handler: NodeData, file_id: str, file_path: str,
        repo_id: str, result: ParseResult
    ) -> None:
        # Try to extract path from annotation arguments
        path = "/"
        for child in method_node_ast.named_children:
            if child.type == "modifiers":
                for mod in child.named_children:
                    if mod.type == "annotation":
                        name = mod.child_by_field_name("name")
                        if _text(name) == annotation:
                            args = mod.child_by_field_name("arguments")
                            if args:
                                for a in args.named_children:
                                    if a.type == "string_literal":
                                        path = _text(a).strip('"')
                                    elif a.type == "element_value_pair":
                                        key = a.child_by_field_name("key")
                                        val = a.child_by_field_name("value")
                                        if _text(key) in ("value", "path"):
                                            path = _text(val).strip('"')

        http_verb = _ANNOTATION_TO_VERB.get(annotation, "ANY")
        ep_id = str(uuid.uuid4())
        ep_node = NodeData(
            id=ep_id, type="RestEndpoint",
            name=f"{http_verb} {path}",
            repo_id=repo_id, file_path=file_path,
            start_line=handler.start_line, end_line=handler.end_line,
            properties={"http_method": http_verb, "path": path},
        )
        result.nodes.append(ep_node)
        result.edges.append(EdgeData(source_id=file_id, target_id=ep_id, type="EXPOSES_ENDPOINT"))
        result.edges.append(EdgeData(source_id=ep_id, target_id=handler.id, type="CALLS"))

    def _collect_calls(self, node: Node, caller_id: str, result: ParseResult) -> None:
        if node.type == "method_invocation":
            name_node = node.child_by_field_name("name")
            obj_node = node.child_by_field_name("object")
            callee = _text(name_node)
            obj = _text(obj_node)
            if callee:
                result.call_sites.append(
                    CallSite(caller_node_id=caller_id, callee_name=callee, callee_object=obj)
                )
        for child in node.children:
            if child.type not in ("class_declaration", "lambda_expression"):
                self._collect_calls(child, caller_id, result)

    def _extract_import(self, node: Node, file_id: str, result: ParseResult) -> None:
        fqn = ""
        for child in node.named_children:
            if child.type == "scoped_identifier":
                fqn = _text(child)
        if fqn:
            result.import_refs.append(ImportRef(
                file_node_id=file_id,
                module_path=fqn,
                from_module=fqn,
                imported_names=[fqn.rsplit(".", 1)[-1]],
                is_relative=False,
            ))
