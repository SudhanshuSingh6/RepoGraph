"""Extracts each file's import statements with tree-sitter (repograph-spec.md §6).

Replaces the prototype's regex `parseFile`: the AST already separates comments and
strings from code, so a commented-out import never counts and nothing needs stripping.
Resolution of what these imports point at lives in resolve.py.
"""

from dataclasses import dataclass, field

import tree_sitter_java
import tree_sitter_javascript
import tree_sitter_python
import tree_sitter_typescript
from tree_sitter import Language, Node, Parser, Query, QueryCursor


@dataclass(frozen=True)
class PyImport:
    dots: int  # relative-import depth; 0 = absolute
    module: str  # dotted path, '' for `from . import x`
    names: tuple[str, ...] = ()  # `from … import names`; empty for `import a.b` and `*`


@dataclass(frozen=True)
class JavaImport:
    name: str  # `a.b.C`, or the package `a.b` for a wildcard
    wildcard: bool = False


@dataclass
class Imports:
    specifiers: list[str] = field(default_factory=list)  # JS/TS
    python: list[PyImport] = field(default_factory=list)
    java_package: str | None = None
    java: list[JavaImport] = field(default_factory=list)


JS_QUERY = """
(import_statement source: (string) @src)
(export_statement source: (string) @src)
(call_expression function: (identifier) @fn arguments: (arguments . (string) @src)
  (#eq? @fn "require"))
(call_expression function: (import) arguments: (arguments . (string) @src))
"""
# TypeScript's `import fs = require('fs')` is its own node.
TS_QUERY = JS_QUERY + "(import_require_clause source: (string) @src)\n"
PY_QUERY = "(import_statement) @imp (import_from_statement) @imp"
JAVA_QUERY = "(package_declaration) @pkg (import_declaration) @imp"


class _Grammar:
    def __init__(self, language: object, query: str):
        lang = Language(language)
        self.parser = Parser(lang)
        self.query = Query(lang, query)

    def captures(self, source: bytes) -> dict[str, list[Node]]:
        tree = self.parser.parse(source)
        return QueryCursor(self.query).captures(tree.root_node)


_GRAMMARS: dict[str, _Grammar] = {}


def _grammar(key: str) -> _Grammar:
    if key not in _GRAMMARS:  # built lazily: only the languages a repo actually uses
        _GRAMMARS[key] = {
            "js": lambda: _Grammar(tree_sitter_javascript.language(), JS_QUERY),
            "ts": lambda: _Grammar(tree_sitter_typescript.language_typescript(), TS_QUERY),
            # .tsx needs its own grammar: `<T>x` casts are JSX there.
            "tsx": lambda: _Grammar(tree_sitter_typescript.language_tsx(), TS_QUERY),
            "py": lambda: _Grammar(tree_sitter_python.language(), PY_QUERY),
            "java": lambda: _Grammar(tree_sitter_java.language(), JAVA_QUERY),
        }[key]()
    return _GRAMMARS[key]


def _text(node: Node) -> str:
    return node.text.decode("utf-8", errors="replace") if node.text else ""


def _in_order(nodes: list[Node]) -> list[Node]:
    return sorted(nodes, key=lambda n: n.start_byte)


def _js(source: bytes, grammar: str) -> Imports:
    caps = _grammar(grammar).captures(source)
    specs: list[str] = []
    for node in _in_order(caps.get("src", [])):
        # Only plain string literals; a template or variable can't be resolved statically.
        if node.type == "string":
            spec = _text(node)[1:-1]
            if spec and spec not in specs:
                specs.append(spec)
    return Imports(specifiers=specs)


def _dotted(node: Node | None) -> str:
    return _text(node) if node is not None else ""


def _python(source: bytes) -> Imports:
    out: list[PyImport] = []
    for node in _in_order(_grammar("py").captures(source).get("imp", [])):
        if node.type == "import_statement":
            # import a.b.c, d.e as f
            for n in node.children_by_field_name("name"):
                target = n.child_by_field_name("name") if n.type == "aliased_import" else n
                out.append(PyImport(0, _dotted(target)))
            continue
        # from <dots><module> import names
        mod = node.child_by_field_name("module_name")
        dots, module = 0, ""
        if mod is not None and mod.type == "relative_import":
            for c in mod.named_children:
                if c.type == "import_prefix":
                    dots = len(_text(c).strip())
                elif c.type == "dotted_name":
                    module = _text(c)
        else:
            module = _dotted(mod)
        names = []
        for n in node.children_by_field_name("name"):
            target = n.child_by_field_name("name") if n.type == "aliased_import" else n
            names.append(_dotted(target))
        out.append(PyImport(dots, module, tuple(names)))
    return Imports(python=out)


def _java(source: bytes) -> Imports:
    caps = _grammar("java").captures(source)
    package = None
    for node in _in_order(caps.get("pkg", [])):
        for c in node.named_children:
            if c.type in ("scoped_identifier", "identifier"):
                package = _text(c)
                break
        break
    imports: list[JavaImport] = []
    for node in _in_order(caps.get("imp", [])):
        name = next((_text(c) for c in node.named_children
                     if c.type in ("scoped_identifier", "identifier")), "")
        wildcard = any(c.type == "asterisk" for c in node.named_children)
        if name:
            imports.append(JavaImport(name, wildcard))
    return Imports(java_package=package, java=imports)


def extract_imports(path: str, lang: str, content: str) -> Imports:
    source = content.encode("utf-8")
    if lang == "py":
        return _python(source)
    if lang == "java":
        return _java(source)
    if lang == "ts":
        return _js(source, "tsx" if path.endswith(".tsx") else "ts")
    return _js(source, "js")
