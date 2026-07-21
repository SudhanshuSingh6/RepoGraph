import uuid
from pathlib import Path

import tree_sitter_python as tspython
from tree_sitter import Language, Node, Parser

from .base import (
    CallSite,
    EdgeData,
    ImportRef,
    InheritanceRef,
    NodeData,
    ParseResult,
    classify_role,
)

_LANGUAGE = Language(tspython.language())
_PARSER = Parser(_LANGUAGE)

_HTTP_METHODS = {"route", "get", "post", "put", "delete", "patch", "head", "options"}

_BRANCH_TYPES = {
    "if_statement",
    "elif_clause",
    "for_statement",
    "while_statement",
    "except_clause",
    "boolean_operator",
    "conditional_expression",
}


def _text(node: Node | None) -> str:
    return node.text.decode("utf-8", errors="replace") if node else ""


def _count_branches(node: Node) -> int:
    count = 1 if node.type in _BRANCH_TYPES else 0
    for child in node.children:
        count += _count_branches(child)
    return count


class PythonParser:
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
            id=file_id,
            type="File",
            name=abs_path.name,
            repo_id=repo_id,
            file_path=rel_path,
            start_line=1,
            end_line=source.count(b"\n") + 1,
            properties={"language": "Python"},
        )
        result.nodes.append(file_node)
        self._walk_module(root, rel_path, file_id, repo_id, result)
        return result

    # ------------------------------------------------------------------ #
    #  Module-level walk                                                   #
    # ------------------------------------------------------------------ #

    def _walk_module(
        self, node: Node, file_path: str, file_id: str, repo_id: str, result: ParseResult
    ) -> None:
        for child in node.named_children:
            t = child.type
            if t == "class_definition":
                self._extract_class(child, file_path, file_id, repo_id, result)
            elif t == "function_definition":
                self._extract_method(child, file_path, file_id, None, repo_id, result, [])
            elif t == "decorated_definition":
                self._extract_decorated(child, file_path, file_id, None, repo_id, result)
            elif t in ("import_statement", "import_from_statement"):
                self._extract_import(child, file_id, result)

    # ------------------------------------------------------------------ #
    #  Class                                                               #
    # ------------------------------------------------------------------ #

    def _extract_class(
        self,
        node: Node,
        file_path: str,
        file_id: str,
        repo_id: str,
        result: ParseResult,
        decorators: list[Node] | None = None,
    ) -> NodeData | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        class_id = str(uuid.uuid4())
        class_name = _text(name_node)
        props: dict = {}
        role = classify_role(class_name, file_path)
        if role:
            props["role"] = role
        class_node = NodeData(
            id=class_id,
            type="Class",
            name=class_name,
            repo_id=repo_id,
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            end_line=node.end_point[0] + 1,
            properties=props,
        )
        result.nodes.append(class_node)
        result.edges.append(EdgeData(source_id=file_id, target_id=class_id, type="CONTAINS"))

        # Superclasses → EXTENDS (resolved in pass 2)
        superclasses = node.child_by_field_name("superclasses")
        if superclasses:
            for sc in superclasses.named_children:
                parent = _text(sc).strip()
                if parent and parent != "object":
                    result.inheritance_refs.append(
                        InheritanceRef(
                            child_node_id=class_id, parent_name=parent, ref_type="EXTENDS"
                        )
                    )

        body = node.child_by_field_name("body")
        if body:
            for child in body.named_children:
                t = child.type
                if t == "function_definition":
                    self._extract_method(child, file_path, file_id, class_node, repo_id, result, [])
                elif t == "decorated_definition":
                    self._extract_decorated(child, file_path, file_id, class_node, repo_id, result)

        return class_node

    # ------------------------------------------------------------------ #
    #  Decorated definition                                                #
    # ------------------------------------------------------------------ #

    def _extract_decorated(
        self,
        node: Node,
        file_path: str,
        file_id: str,
        parent_class: NodeData | None,
        repo_id: str,
        result: ParseResult,
    ) -> None:
        decorators: list[Node] = []
        definition: Node | None = None

        for child in node.named_children:
            if child.type == "decorator":
                decorators.append(child)
            elif child.type == "function_definition":
                definition = child
            elif child.type == "class_definition":
                self._extract_class(child, file_path, file_id, repo_id, result, decorators)
                return

        if definition:
            method_node = self._extract_method(
                definition, file_path, file_id, parent_class, repo_id, result, decorators
            )
            if method_node:
                for dec in decorators:
                    self._try_rest_endpoint(dec, method_node, file_id, file_path, repo_id, result)

    # ------------------------------------------------------------------ #
    #  REST endpoint detection                                             #
    # ------------------------------------------------------------------ #

    def _try_rest_endpoint(
        self,
        decorator: Node,
        handler: NodeData,
        file_id: str,
        file_path: str,
        repo_id: str,
        result: ParseResult,
    ) -> None:
        for child in decorator.named_children:
            if child.type != "call":
                continue
            func = child.child_by_field_name("function")
            args = child.child_by_field_name("arguments")
            if not func or func.type != "attribute":
                continue
            attr = func.child_by_field_name("attribute")
            method_name = _text(attr).lower()
            if method_name not in _HTTP_METHODS:
                continue

            path = ""
            http_verb = "GET" if method_name == "route" else method_name.upper()
            if args:
                for arg in args.named_children:
                    if arg.type == "string" and not path:
                        path = _text(arg).strip("'\"`")
                    elif arg.type == "keyword_argument" and method_name == "route":
                        kw_name = arg.child_by_field_name("name")
                        kw_val = arg.child_by_field_name("value")
                        if _text(kw_name) == "methods" and kw_val:
                            for item in kw_val.named_children:
                                if item.type == "string":
                                    http_verb = _text(item).strip("'\"").upper()
                                    break
            ep_id = str(uuid.uuid4())
            ep_node = NodeData(
                id=ep_id,
                type="RestEndpoint",
                name=f"{http_verb} {path}",
                repo_id=repo_id,
                file_path=file_path,
                start_line=handler.start_line,
                end_line=handler.end_line,
                properties={"http_method": http_verb, "path": path},
            )
            result.nodes.append(ep_node)
            result.edges.append(
                EdgeData(source_id=file_id, target_id=ep_id, type="EXPOSES_ENDPOINT")
            )
            result.edges.append(EdgeData(source_id=ep_id, target_id=handler.id, type="CALLS"))
            return

    # ------------------------------------------------------------------ #
    #  Method / function                                                   #
    # ------------------------------------------------------------------ #

    def _extract_method(
        self,
        node: Node,
        file_path: str,
        file_id: str,
        parent_class: NodeData | None,
        repo_id: str,
        result: ParseResult,
        decorators: list[Node],
    ) -> NodeData | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        body = node.child_by_field_name("body")
        complexity = 1 + (_count_branches(body) if body else 0)

        method_id = str(uuid.uuid4())
        method_node = NodeData(
            id=method_id,
            type="Method",
            name=_text(name_node),
            repo_id=repo_id,
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            end_line=node.end_point[0] + 1,
            properties={
                "complexity": complexity,
                "lines": node.end_point[0] - node.start_point[0] + 1,
            },
        )
        result.nodes.append(method_node)

        parent_id = parent_class.id if parent_class else file_id
        result.edges.append(EdgeData(source_id=parent_id, target_id=method_id, type="CONTAINS"))

        if body:
            self._collect_calls(body, method_id, result)

        return method_node

    # ------------------------------------------------------------------ #
    #  Call collection                                                     #
    # ------------------------------------------------------------------ #

    def _collect_calls(self, node: Node, caller_id: str, result: ParseResult) -> None:
        if node.type == "call":
            func = node.child_by_field_name("function")
            if func:
                callee, obj = self._parse_call_target(func)
                if callee:
                    result.call_sites.append(
                        CallSite(caller_node_id=caller_id, callee_name=callee, callee_object=obj)
                    )
        for child in node.children:
            # Don't descend into nested function/class bodies
            if child.type not in ("function_definition", "class_definition", "lambda"):
                self._collect_calls(child, caller_id, result)

    def _parse_call_target(self, node: Node) -> tuple[str, str]:
        if node.type == "identifier":
            return _text(node), ""
        if node.type == "attribute":
            obj = node.child_by_field_name("object")
            attr = node.child_by_field_name("attribute")
            return _text(attr), _text(obj)
        if node.type == "call":
            func = node.child_by_field_name("function")
            if func:
                return self._parse_call_target(func)
        return "", ""

    # ------------------------------------------------------------------ #
    #  Imports                                                             #
    # ------------------------------------------------------------------ #

    def _extract_import(self, node: Node, file_id: str, result: ParseResult) -> None:
        if node.type == "import_statement":
            for child in node.named_children:
                module = ""
                if child.type == "dotted_name":
                    module = _text(child)
                elif child.type == "aliased_import":
                    n = child.child_by_field_name("name")
                    module = _text(n)
                if module:
                    result.import_refs.append(
                        ImportRef(
                            file_node_id=file_id,
                            module_path=module,
                            from_module="",
                            imported_names=[module],
                            is_relative=False,
                        )
                    )

        elif node.type == "import_from_statement":
            module_text = ""
            is_relative = False
            imported: list[str] = []
            module_found = False

            for child in node.children:
                t = child.type
                if t == "relative_import":
                    is_relative = True
                    module_text = _text(child)
                    module_found = True
                elif t == "dotted_name" and not module_found:
                    module_text = _text(child)
                    module_found = True
                elif t == "import_list":
                    for item in child.named_children:
                        if item.type == "dotted_name":
                            imported.append(_text(item))
                        elif item.type == "aliased_import":
                            n = item.child_by_field_name("name")
                            imported.append(_text(n))
                elif t == "dotted_name" and module_found:
                    imported.append(_text(child))
                elif t == "wildcard_import":
                    imported.append("*")

            result.import_refs.append(
                ImportRef(
                    file_node_id=file_id,
                    module_path=module_text,
                    from_module=module_text,
                    imported_names=imported,
                    is_relative=is_relative,
                )
            )
