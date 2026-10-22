"""Extracts per-file facts with tree-sitter, parsing each file once: its import
statements (repograph-spec.md §6), its class/interface declarations (§11) and, among
those classes, its ORM entities (§12, in entities.py).

Replaces the prototype's regex `parseFile`/`extractTypes`: the AST already separates
comments and strings from code, so a commented-out import or class never counts and
nothing needs stripping. Resolution of what imports point at lives in resolve.py; type
names are resolved later, in packages/analysis/types.
"""

from dataclasses import dataclass, field

import tree_sitter_java
import tree_sitter_javascript
import tree_sitter_python
import tree_sitter_typescript
from tree_sitter import Language, Node, Parser, Query, QueryCursor

from entities import Entity, extract_entities


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


@dataclass(frozen=True)
class TypeDecl:
    name: str
    kind: str  # class | abstract | interface | enum | record
    extends: tuple[str, ...] = ()  # supertype names as written, minus type arguments
    implements: tuple[str, ...] = ()
    line: int = 0  # 1-based


@dataclass
class FileFacts:
    imports: Imports
    types: list[TypeDecl]
    entities: list[Entity] = field(default_factory=list)


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

JS_TYPES = "(class_declaration) @t"
TS_TYPES = "(class_declaration) @t (abstract_class_declaration) @t (interface_declaration) @t"
PY_TYPES = "(class_definition) @t"
JAVA_TYPES = """
(class_declaration) @t (interface_declaration) @t (enum_declaration) @t (record_declaration) @t
"""


class _Grammar:
    def __init__(self, language: object, imports: str, types: str):
        lang = Language(language)
        self.parser = Parser(lang)
        self.queries = {"imports": Query(lang, imports), "types": Query(lang, types)}

    def parse(self, source: bytes) -> Node:
        return self.parser.parse(source).root_node

    def captures(self, root: Node, query: str) -> dict[str, list[Node]]:
        return QueryCursor(self.queries[query]).captures(root)


_GRAMMARS: dict[str, _Grammar] = {}


def _grammar(key: str) -> _Grammar:
    if key not in _GRAMMARS:  # built lazily: only the languages a repo actually uses
        _GRAMMARS[key] = {
            "js": lambda: _Grammar(tree_sitter_javascript.language(), JS_QUERY, JS_TYPES),
            "ts": lambda: _Grammar(tree_sitter_typescript.language_typescript(), TS_QUERY,
                                   TS_TYPES),
            # .tsx needs its own grammar: `<T>x` casts are JSX there.
            "tsx": lambda: _Grammar(tree_sitter_typescript.language_tsx(), TS_QUERY, TS_TYPES),
            "py": lambda: _Grammar(tree_sitter_python.language(), PY_QUERY, PY_TYPES),
            "java": lambda: _Grammar(tree_sitter_java.language(), JAVA_QUERY, JAVA_TYPES),
        }[key]()
    return _GRAMMARS[key]


def _text(node: Node) -> str:
    return node.text.decode("utf-8", errors="replace") if node.text else ""


def _in_order(nodes: list[Node]) -> list[Node]:
    return sorted(nodes, key=lambda n: n.start_byte)


def _js(g: _Grammar, root: Node) -> Imports:
    caps = g.captures(root, "imports")
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


def _python(g: _Grammar, root: Node) -> Imports:
    out: list[PyImport] = []
    for node in _in_order(g.captures(root, "imports").get("imp", [])):
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


def _java(g: _Grammar, root: Node) -> Imports:
    caps = g.captures(root, "imports")
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


def _type_name(node: Node) -> str | None:
    """A supertype reference as written, without type arguments: `B<T>` → `B`,
    `a.b.C` stays `a.b.C`, `Generic[T]` → `Generic`. None for anything that isn't a
    plain (possibly qualified) name, e.g. `extends mixin(Base)`."""
    if node.type in ("generic_type", "subscript"):
        inner = node.child_by_field_name("name") or node.child_by_field_name("value") \
            or (node.named_children[0] if node.named_children else None)
        return _type_name(inner) if inner is not None else None
    if node.type in ("identifier", "type_identifier", "scoped_type_identifier",
                     "scoped_identifier", "nested_type_identifier", "member_expression",
                     "attribute"):
        return _text(node)
    return None


def _names(nodes: list[Node]) -> tuple[str, ...]:
    return tuple(n for n in (_type_name(c) for c in nodes) if n)


def _line(node: Node) -> int:
    return node.start_point[0] + 1


JAVA_KINDS = {"class_declaration": "class", "interface_declaration": "interface",
              "enum_declaration": "enum", "record_declaration": "record"}


def _java_types(classes: list[Node]) -> list[TypeDecl]:
    out = []
    for node in classes:
        name = node.child_by_field_name("name")
        if name is None:
            continue
        kind = JAVA_KINDS[node.type]
        mods = next((c for c in node.children if c.type == "modifiers"), None)
        if kind == "class" and mods is not None and any(c.type == "abstract" for c in mods.children):
            kind = "abstract"
        extends: tuple[str, ...] = ()
        implements: tuple[str, ...] = ()
        sup = node.child_by_field_name("superclass")
        if sup is not None:
            extends = _names(sup.named_children)
        ifaces = node.child_by_field_name("interfaces")
        if ifaces is not None:
            implements = _names([t for tl in ifaces.named_children for t in tl.named_children])
        for c in node.named_children:  # an interface's `extends A, B`
            if c.type == "extends_interfaces":
                extends = _names([t for tl in c.named_children for t in tl.named_children])
        out.append(TypeDecl(_text(name), kind, extends, implements, _line(node)))
    return out


def _js_types(classes: list[Node]) -> list[TypeDecl]:
    out = []
    for node in classes:
        name = node.child_by_field_name("name")
        if name is None:
            continue
        if node.type == "interface_declaration":
            ext = [c for c in node.named_children if c.type == "extends_type_clause"]
            extends = _names([t for c in ext for t in c.children_by_field_name("type")])
            out.append(TypeDecl(_text(name), "interface", extends, (), _line(node)))
            continue
        extends: tuple[str, ...] = ()
        implements: tuple[str, ...] = ()
        for heritage in (c for c in node.named_children if c.type == "class_heritage"):
            for c in heritage.named_children:
                if c.type == "extends_clause":  # TypeScript
                    extends = _names(c.children_by_field_name("value"))
                elif c.type == "implements_clause":
                    implements = _names(c.named_children)
                else:  # JavaScript: the superclass expression sits directly here
                    extends = _names([c])
        kind = "abstract" if node.type == "abstract_class_declaration" else "class"
        out.append(TypeDecl(_text(name), kind, extends, implements, _line(node)))
    return out


def _py_types(classes: list[Node]) -> list[TypeDecl]:
    out = []
    for node in classes:
        name = node.child_by_field_name("name")
        if name is None:
            continue
        bases = node.child_by_field_name("superclasses")
        # Keyword arguments (`metaclass=…`) aren't bases; `object` is every class's.
        supers = _names([b for b in bases.named_children if b.type != "keyword_argument"]) \
            if bases is not None else ()
        extends = tuple(b for b in supers if b != "object")
        out.append(TypeDecl(_text(name), "class", extends, (), _line(node)))
    return out


def _grammar_key(path: str, lang: str) -> str:
    if lang == "ts":
        return "tsx" if path.endswith(".tsx") else "ts"
    return lang


def analyze_file(path: str, lang: str, content: str) -> FileFacts:
    """Parses the file once and extracts everything the worker stores about it."""
    g = _grammar(_grammar_key(path, lang))
    root = g.parse(content.encode("utf-8"))
    classes = _in_order(g.captures(root, "types").get("t", []))
    entities = extract_entities(lang, classes)
    if lang == "py":
        return FileFacts(_python(g, root), _py_types(classes), entities)
    if lang == "java":
        return FileFacts(_java(g, root), _java_types(classes), entities)
    return FileFacts(_js(g, root), _js_types(classes), entities)


def extract_imports(path: str, lang: str, content: str) -> Imports:
    return analyze_file(path, lang, content).imports
