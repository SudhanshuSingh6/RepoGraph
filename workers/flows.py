"""Per-file facts for the APIs view: functions, class members, symbol-level imports
(bindings) and exports, and the raw route declarations of the supported web frameworks
(Spring, NestJS, Express, Flask, FastAPI, Django).

Everything here is syntax only, from the one tree-sitter parse `analyze_file` already
does. Anything that needs another file — resolving a binding to its target, composing
router/blueprint/include prefixes, finding a Django view's class — happens in
flow_link.py once every file is parsed.
"""

from dataclasses import dataclass, field

from tree_sitter import Node


@dataclass
class Param:
    name: str
    type: str | None = None


@dataclass
class Function:
    name: str
    owner: str | None  # enclosing class
    line: int
    end_line: int
    params: list[Param] = field(default_factory=list)
    static: bool = False
    scope: str | None = None  # enclosing function, for nested defs
    synthetic: bool = False  # an anonymous route handler, named after its route
    action: dict | None = None  # DRF @action(detail=, methods=, url_path=)


@dataclass
class Member:
    owner: str
    name: str
    type: str


@dataclass
class Binding:
    """A local name introduced by an import. `spec` is the JS specifier, the Python
    module (with `dots` for relative imports) or the Java qualified name; resolving it
    to a repo file happens in flow_link.py."""
    local: str
    # named | default | namespace (ES `* as`) | require (CommonJS: module.exports) |
    # module (Python) | star | static | package (Java wildcard)
    kind: str
    spec: str
    name: str | None = None  # the imported symbol, for named/default/static
    dots: int = 0
    type_only: bool = False


@dataclass
class Export:
    name: str  # the exported name; 'default' or '*' for JS default / export *
    local: str | None = None  # the local symbol it refers to, if any
    spec: str | None = None  # re-export source specifier
    from_name: str | None = None  # the name re-exported from `spec` ('*' for all)


@dataclass
class RouteDecl:
    framework: str  # spring | nestjs | express | flask | fastapi
    methods: list[str]
    path: str
    line: int
    router: str | None = None  # the app/router/blueprint variable it's declared on
    handler_fn: int | None = None  # index into this file's functions
    handler_ref: str | None = None  # an identifier or dotted name to resolve later
    handler_label: str = ""


@dataclass
class RouterDecl:
    """A variable holding an app or router. `kind` decides how prefixes compose."""
    var: str
    kind: str  # express-app | express-router | flask-app | blueprint | fastapi-app | apirouter | param
    framework: str
    prefix: str = ""  # Blueprint(url_prefix=) / APIRouter(prefix=)
    line: int = 0


@dataclass
class Mount:
    """`app.use('/p', r)`, `app.register_blueprint(bp, url_prefix=)`,
    `app.include_router(r, prefix=)`."""
    framework: str
    on: str  # the parent variable
    target: str  # the child: an identifier, a dotted name or `require:<spec>`
    prefix: str | None  # None = not given (Flask then uses the blueprint's own)
    line: int
    # kind 'pass': the router `on` is passed as argument `arg` to the function named by
    # `target` (`register(app)`), so that function's parameter is the same router.
    arg: int | None = None


@dataclass
class UrlPattern:
    """One Django urlpatterns entry."""
    route: str
    line: int
    regex: bool = False
    view: str | None = None  # a function view's dotted name
    view_class: str | None = None  # `X.as_view()` → X
    include_module: str | None = None  # include('app.urls')
    include_router: str | None = None  # include(router.urls) → router
    include_list: list["UrlPattern"] | None = None  # include([...])
    external_urls: bool = False  # `admin.site.urls` and the like: a library URLconf


@dataclass
class DrfRegistration:
    router: str
    prefix: str
    viewset: str
    line: int


@dataclass
class FlowFacts:
    functions: list[Function] = field(default_factory=list)
    members: list[Member] = field(default_factory=list)
    bindings: list[Binding] = field(default_factory=list)
    exports: list[Export] = field(default_factory=list)
    routes: list[RouteDecl] = field(default_factory=list)
    routers: list[RouterDecl] = field(default_factory=list)
    mounts: list[Mount] = field(default_factory=list)
    urlpatterns: list[UrlPattern] = field(default_factory=list)
    drf: list[DrfRegistration] = field(default_factory=list)
    drf_routers: list[str] = field(default_factory=list)  # DefaultRouter()/SimpleRouter() vars
    drf_no_slash: list[str] = field(default_factory=list)  # …(trailing_slash=False)
    router_urls_appended: list[str] = field(default_factory=list)  # urlpatterns += r.urls
    root_urlconf: str | None = None  # settings: ROOT_URLCONF = '…'
    global_prefix: str | None = None  # Nest: app.setGlobalPrefix('…')
    package: str | None = None  # Java


HTTP_VERBS = ("get", "post", "put", "patch", "delete", "options", "head")
DEFAULT_ROUTER = "<default export>"  # an anonymous router expression exported as default


# --- helpers -------------------------------------------------------------------------

def _text(node: Node | None) -> str:
    return node.text.decode("utf-8", errors="replace") if node is not None and node.text else ""


def _line(node: Node) -> int:
    return node.start_point[0] + 1


def _end_line(node: Node) -> int:
    return node.end_point[0] + 1


def _named(node: Node, *types: str) -> list[Node]:
    return [c for c in node.named_children if c.type in types]


def _first(node: Node, *types: str) -> Node | None:
    return next((c for c in node.named_children if c.type in types), None)


def _walk(node: Node):
    stack = [node]
    while stack:
        n = stack.pop()
        yield n
        stack.extend(reversed(n.named_children))


def js_string(node: Node | None) -> str | None:
    """A JS/TS string literal's value; a template literal with `${x}` parts becomes
    `{x}`. None for anything that isn't a literal."""
    if node is None:
        return None
    if node.type == "string":
        return _text(node)[1:-1]
    if node.type == "template_string":
        out = []
        for c in node.children:
            if c.type == "string_fragment":
                out.append(_text(c))
            elif c.type == "template_substitution":
                inner = c.named_children[0] if c.named_children else None
                out.append("{" + (_text(inner) if inner is not None else "…") + "}")
            elif c.type == "escape_sequence":
                out.append(_text(c))
        return "".join(out)
    return None


def py_string(node: Node | None) -> str | None:
    """A Python string literal's value (prefixes like r/f stripped); f-string
    interpolations become `{x}`. None for anything that isn't a literal."""
    if node is None:
        return None
    if node.type == "concatenated_string":
        parts = [py_string(c) for c in node.named_children]
        return None if any(p is None for p in parts) else "".join(p for p in parts if p)
    if node.type != "string":
        return None
    out = []
    for c in node.named_children:
        if c.type == "string_content":
            out.append(_text(c))
        elif c.type == "interpolation":
            inner = c.named_children[0] if c.named_children else None
            out.append("{" + (_text(inner) if inner is not None else "…") + "}")
        elif c.type == "escape_sequence":
            out.append(_text(c))
    return "".join(out)


def java_string(node: Node | None) -> str | None:
    if node is None or node.type != "string_literal":
        return None
    return "".join(_text(c) for c in node.named_children
                   if c.type in ("string_fragment", "escape_sequence"))


def _placeholder(node: Node) -> str:
    """A non-literal path piece (a constant, a variable) shown as `{NAME}`."""
    return "{" + _text(node) + "}"


# --- JavaScript / TypeScript ---------------------------------------------------------

def _js_type(node: Node | None) -> str | None:
    if node is None:
        return None
    if node.type == "type_annotation":
        node = node.named_children[0] if node.named_children else None
        if node is None:
            return None
    if node.type == "generic_type":
        return _js_type(node.child_by_field_name("name"))
    if node.type in ("type_identifier", "nested_type_identifier", "identifier"):
        return _text(node)
    return None


def _js_params(params: Node | None) -> list[Param]:
    out: list[Param] = []
    if params is None:
        return out
    for p in params.named_children:
        if p.type == "identifier":
            out.append(Param(_text(p)))
        elif p.type in ("required_parameter", "optional_parameter"):
            pat = p.child_by_field_name("pattern")
            name = _text(pat) if pat is not None and pat.type == "identifier" else _text(pat)
            out.append(Param(name, _js_type(p.child_by_field_name("type"))))
        elif p.type == "assignment_pattern":
            out.append(Param(_text(p.child_by_field_name("left"))))
        elif p.type == "rest_pattern":
            out.append(Param(_text(p).lstrip(".")))
    return out


JS_FUNCTION_VALUES = ("arrow_function", "function_expression", "function", "generator_function")


class _Js:
    def __init__(self, root: Node):
        self.root = root
        self.f = FlowFacts()
        self.express_names: set[str] = set()  # local names bound to the express module
        self.router_ctor: set[str] = set()  # local names bound to express's Router
        self.imports_express = False
        self.imports_nest = False
        self.param_routers: set[str] = set()
        self.default_expr: Node | None = None

    def run(self) -> FlowFacts:
        self._imports_and_exports()
        self._functions(self.root, None, None)
        self._routers()
        self._routes()
        return self.f

    # imports / exports
    def _imports_and_exports(self) -> None:
        for node in self.root.named_children:
            if node.type == "import_statement":
                self._import(node)
            elif node.type == "export_statement":
                self._export(node)
            elif node.type in ("lexical_declaration", "variable_declaration"):
                for d in _named(node, "variable_declarator"):
                    self._require(d)
            elif node.type == "expression_statement":
                self._commonjs_export(node.named_children[0] if node.named_children else None)
        # require() calls anywhere else (inside functions) still bind names, but only
        # top-level ones are module-wide; nested ones are rare and stay unresolved.

    def _import(self, node: Node) -> None:
        src = js_string(node.child_by_field_name("source"))
        if src is None:
            return
        type_only = any(c.type == "type" for c in node.children)
        self._note_module(src)
        clause = _first(node, "import_clause")
        if clause is None:
            # TS `import x = require('m')`
            req = _first(node, "import_require_clause")
            if req is not None:
                ident = _first(req, "identifier")
                if ident is not None:
                    self.f.bindings.append(Binding(_text(ident), "require", src))
                    if src == "express":
                        self.express_names.add(_text(ident))
            return
        for c in clause.named_children:
            if c.type == "identifier":
                self.f.bindings.append(Binding(_text(c), "default", src, "default",
                                               type_only=type_only))
                if src == "express":
                    self.express_names.add(_text(c))
            elif c.type == "namespace_import":
                ident = _first(c, "identifier")
                if ident is not None:
                    self.f.bindings.append(Binding(_text(ident), "namespace", src,
                                                   type_only=type_only))
                    if src == "express":
                        self.express_names.add(_text(ident))
            elif c.type == "named_imports":
                for spec in _named(c, "import_specifier"):
                    name = _text(spec.child_by_field_name("name"))
                    alias = spec.child_by_field_name("alias")
                    local = _text(alias) if alias is not None else name
                    spec_type_only = type_only or any(x.type == "type" for x in spec.children)
                    self.f.bindings.append(Binding(local, "named", src, name,
                                                   type_only=spec_type_only))
                    if src == "express" and name == "Router":
                        self.router_ctor.add(local)

    def _note_module(self, src: str) -> None:
        if src == "express":
            self.imports_express = True
        if src.startswith("@nestjs/"):
            self.imports_nest = True

    def _require(self, decl: Node) -> None:
        value = decl.child_by_field_name("value")
        name = decl.child_by_field_name("name")
        spec = self._require_spec(value)
        if spec is None or name is None:
            return
        self._note_module(spec)
        if name.type == "identifier":
            self.f.bindings.append(Binding(_text(name), "require", spec))
            if spec == "express":
                self.express_names.add(_text(name))
        elif name.type == "object_pattern":
            for p in name.named_children:
                if p.type == "shorthand_property_identifier_pattern":
                    self.f.bindings.append(Binding(_text(p), "named", spec, _text(p)))
                    if spec == "express" and _text(p) == "Router":
                        self.router_ctor.add("Router")
                elif p.type == "pair_pattern":
                    key, val = p.child_by_field_name("key"), p.child_by_field_name("value")
                    if val is not None and val.type == "identifier":
                        self.f.bindings.append(Binding(_text(val), "named", spec, _text(key)))
                        if spec == "express" and _text(key) == "Router":
                            self.router_ctor.add(_text(val))

    @staticmethod
    def _require_spec(node: Node | None) -> str | None:
        if node is None or node.type != "call_expression":
            return None
        fn = node.child_by_field_name("function")
        if fn is None or fn.type != "identifier" or _text(fn) != "require":
            return None
        args = node.child_by_field_name("arguments")
        first = args.named_children[0] if args is not None and args.named_children else None
        return js_string(first) if first is not None and first.type == "string" else None

    def _export(self, node: Node) -> None:
        src = js_string(node.child_by_field_name("source"))
        if src is not None:
            self._note_module(src)
        decl = node.child_by_field_name("declaration")
        value = node.child_by_field_name("value")
        clause = _first(node, "export_clause")
        is_default = any(c.type == "default" for c in node.children)
        if clause is not None:
            for spec in _named(clause, "export_specifier"):
                name = _text(spec.child_by_field_name("name"))
                alias = spec.child_by_field_name("alias")
                exported = _text(alias) if alias is not None else name
                if src is not None:
                    self.f.exports.append(Export(exported, spec=src, from_name=name))
                else:
                    self.f.exports.append(Export(exported, local=name))
            return
        if src is not None:
            ns = _first(node, "namespace_export")
            if ns is not None:  # export * as ns from './x'
                ident = _first(ns, "identifier", "string")
                self.f.exports.append(Export(_text(ident) if ident is not None else "*",
                                             spec=src, from_name="*"))
            else:
                self.f.exports.append(Export("*", spec=src, from_name="*"))
            return
        if decl is not None:
            names = self._declared_names(decl)
            if is_default:
                self.f.exports.append(Export("default", names[0] if names else None))
            else:
                self.f.exports.extend(Export(n, n) for n in names)
            return
        if value is not None and is_default:
            if value.type == "identifier":
                self.f.exports.append(Export("default", _text(value)))
            elif value.type in JS_FUNCTION_VALUES:
                self.f.exports.append(Export("default", "default"))  # see _functions
            else:
                # `export default Router().use(…)`: maybe an anonymous router, decided in
                # _routers once the express imports are known.
                self.default_expr = value
                self.f.exports.append(Export("default", None))

    @staticmethod
    def _declared_names(decl: Node) -> list[str]:
        if decl.type in ("lexical_declaration", "variable_declaration"):
            return [_text(d.child_by_field_name("name")) for d in _named(decl, "variable_declarator")
                    if d.child_by_field_name("name") is not None
                    and d.child_by_field_name("name").type == "identifier"]
        name = decl.child_by_field_name("name")
        return [_text(name)] if name is not None else []

    def _commonjs_export(self, expr: Node | None) -> None:
        if expr is None or expr.type != "assignment_expression":
            return
        left, right = expr.child_by_field_name("left"), expr.child_by_field_name("right")
        target = _text(left)
        if target == "module.exports":
            if right is not None and right.type == "identifier":
                self.f.exports.append(Export("default", _text(right)))
            elif right is not None and right.type == "object":
                self.f.exports.append(Export("default", None))
                for p in right.named_children:
                    if p.type == "shorthand_property_identifier":
                        self.f.exports.append(Export(_text(p), _text(p)))
                    elif p.type == "pair":
                        key, val = p.child_by_field_name("key"), p.child_by_field_name("value")
                        local = _text(val) if val is not None and val.type == "identifier" \
                            else (_text(key) if val is not None and val.type in JS_FUNCTION_VALUES
                                  else None)
                        self.f.exports.append(Export(_text(key), local))
            elif right is not None and right.type in JS_FUNCTION_VALUES:
                self.f.exports.append(Export("default", "default"))  # see _functions
            else:
                self.f.exports.append(Export("default", None))
        elif target.startswith(("module.exports.", "exports.")):
            name = target.rsplit(".", 1)[1]
            local = _text(right) if right is not None and right.type == "identifier" else \
                (name if right is not None and right.type in JS_FUNCTION_VALUES else None)
            self.f.exports.append(Export(name, local))

    # functions and members
    def _functions(self, node: Node, owner: str | None, scope: str | None) -> None:
        for c in node.named_children:
            t = c.type
            if t in ("class_declaration", "abstract_class_declaration", "class"):
                name = c.child_by_field_name("name")
                body = c.child_by_field_name("body")
                if body is not None:
                    self._class_body(_text(name) if name is not None else None, body)
                continue
            if t in ("function_declaration", "generator_function_declaration"):
                name = c.child_by_field_name("name")
                self._add_fn(_text(name), owner, c, scope)
                self._functions(c, owner, _text(name))
                continue
            if t == "export_statement" and scope is None:
                value = c.child_by_field_name("value")
                decl = c.child_by_field_name("declaration")
                if value is not None and value.type in JS_FUNCTION_VALUES:
                    self._add_fn("default", owner, value, scope)  # export default (app) => …
                    self._functions(value, owner, "default")
                    continue
                if decl is not None and decl.type == "function_declaration" and \
                        decl.child_by_field_name("name") is None:
                    self._add_fn("default", owner, decl, scope)
                    self._functions(decl, owner, "default")
                    continue
            if t == "variable_declarator":
                name, value = c.child_by_field_name("name"), c.child_by_field_name("value")
                if name is not None and name.type == "identifier" and value is not None \
                        and value.type in JS_FUNCTION_VALUES:
                    self._add_fn(_text(name), owner, value, scope)
                    self._functions(value, owner, _text(name))
                    continue
            if t == "assignment_expression":
                left, right = c.child_by_field_name("left"), c.child_by_field_name("right")
                lt = _text(left)
                if right is not None and right.type in JS_FUNCTION_VALUES \
                        and (lt.startswith(("module.exports.", "exports.")) or lt == "module.exports"):
                    # `module.exports = function (app) {…}` is the module's 'default'.
                    name = "default" if lt == "module.exports" else lt.rsplit(".", 1)[1]
                    self._add_fn(name, owner, right, scope)
                    self._functions(right, owner, name)
                    continue
            if t == "pair":  # module.exports = { list: (req, res) => … }
                key, value = c.child_by_field_name("key"), c.child_by_field_name("value")
                if value is not None and value.type in JS_FUNCTION_VALUES and scope is None:
                    self._add_fn(_text(key), owner, value, scope)
                    self._functions(value, owner, _text(key))
                    continue
            self._functions(c, owner, scope)

    def _add_fn(self, name: str, owner: str | None, node: Node, scope: str | None,
                static: bool = False) -> int:
        self.f.functions.append(Function(name, owner, _line(node), _end_line(node),
                                         _js_params(node.child_by_field_name("parameters")),
                                         static, scope))
        return len(self.f.functions) - 1

    def _class_body(self, cls: str | None, body: Node) -> None:
        if cls is None:
            return
        for m in body.named_children:
            if m.type == "method_definition":
                name = _text(m.child_by_field_name("name"))
                static = any(c.type == "static" for c in m.children)
                self._add_fn(name, cls, m, None, static)
                if name == "constructor":
                    params = m.child_by_field_name("parameters")
                    for p in (params.named_children if params is not None else []):
                        if p.type in ("required_parameter", "optional_parameter") and any(
                                c.type in ("accessibility_modifier", "readonly")
                                or _text(c) == "readonly" for c in p.children):
                            t = _js_type(p.child_by_field_name("type"))
                            pat = p.child_by_field_name("pattern")
                            if t and pat is not None:
                                self.f.members.append(Member(cls, _text(pat), t))
                self._functions(m, cls, name)
            elif m.type in ("public_field_definition", "field_definition"):
                name = m.child_by_field_name("name") or m.child_by_field_name("property")
                value = m.child_by_field_name("value")
                t = _js_type(m.child_by_field_name("type"))
                if t and name is not None:
                    self.f.members.append(Member(cls, _text(name), t))
                if value is not None and value.type in JS_FUNCTION_VALUES and name is not None:
                    self._add_fn(_text(name), cls, value, None)

    # Express
    def _routers(self) -> None:
        for node in _walk(self.root):
            if node.type != "variable_declarator":
                continue
            name, value = node.child_by_field_name("name"), node.child_by_field_name("value")
            if name is None or name.type != "identifier" or value is None:
                continue
            kind = self._router_expr(_text(name), value)
            if kind is not None:
                self.f.routers.append(RouterDecl(_text(name), kind, "express", line=_line(node)))
        if self.default_expr is not None:
            kind = self._router_expr(DEFAULT_ROUTER, self.default_expr)
            if kind is not None:
                self.f.routers.append(RouterDecl(DEFAULT_ROUTER, kind, "express",
                                                 line=_line(self.default_expr)))
                for e in self.f.exports:
                    if e.name == "default" and e.local is None:
                        e.local = DEFAULT_ROUTER
        # Function parameters that look like an app/router passed in.
        for fn_node in _walk(self.root):
            if fn_node.type not in ("function_declaration", "arrow_function",
                                    "function_expression", "method_definition"):
                continue
            for p in _js_params(fn_node.child_by_field_name("parameters")):
                if p.type in ("Express", "Application", "Router", "express.Express",
                              "express.Application", "express.Router") or (
                        p.name in ("app", "router") and self.imports_express) or (
                        p.name in ("app", "router") and p.type is None):
                    if not any(r.var == p.name for r in self.f.routers):
                        self.f.routers.append(RouterDecl(p.name, "param", "express",
                                                         line=_line(fn_node)))

    def _router_expr(self, var: str, value: Node) -> str | None:
        """The router kind of an initializer: `Router()`, `express()`, or a chain on one
        (`Router().use(a).use('/p', b)`), whose links are recorded as mounts/routes of
        `var`."""
        kind = self._express_ctor(value)
        if kind is not None:
            return kind
        if value.type != "call_expression":
            return None
        fn = value.child_by_field_name("function")
        if fn is None or fn.type != "member_expression":
            return None
        base = self._router_expr(var, fn.child_by_field_name("object"))
        if base is None:
            return None
        prop = _text(fn.child_by_field_name("property"))
        args = value.child_by_field_name("arguments")
        argv = args.named_children if args is not None else []
        if prop == "use":
            self._express_mount(var, argv, value)
        elif prop in HTTP_VERBS + ("all",) and argv and js_string(argv[0]) is not None \
                and len(argv) >= 2:
            self._express_route(var, prop, js_string(argv[0]), argv[1:], value)
        return base

    def _express_ctor(self, value: Node) -> str | None:
        if value.type != "call_expression":
            return None
        fn = value.child_by_field_name("function")
        if fn is None:
            return None
        text = _text(fn)
        if fn.type == "identifier" and text in self.express_names:
            return "express-app"  # express()
        if fn.type == "identifier" and text in self.router_ctor:
            return "express-router"  # Router()
        if fn.type == "member_expression":
            obj = fn.child_by_field_name("object")
            prop = _text(fn.child_by_field_name("property"))
            if prop == "Router" and obj is not None and (
                    _text(obj) in self.express_names or self._require_spec(obj) == "express"):
                return "express-router"  # express.Router(), require('express').Router()
        if fn.type == "call_expression" and self._require_spec(fn) == "express":
            return "express-app"  # require('express')()
        return None

    def _routes(self) -> None:
        if self.imports_nest:
            self._nest()
        routers = {r.var for r in self.f.routers}
        self.param_routers = {r.var for r in self.f.routers if r.kind == "param"}
        passable = routers | {b.local for b in self.f.bindings}
        for node in _walk(self.root):
            if node.type != "call_expression":
                continue
            fn = node.child_by_field_name("function")
            self._pass_router(node, fn, passable)
            if fn is None or fn.type != "member_expression":
                continue
            prop = _text(fn.child_by_field_name("property"))
            obj = fn.child_by_field_name("object")
            args = node.child_by_field_name("arguments")
            argv = args.named_children if args is not None else []
            if prop == "setGlobalPrefix" and self.imports_nest and argv:
                self.f.global_prefix = js_string(argv[0])
                continue
            # app.route('/p').get(h): the object is the `.route(...)` call (maybe chained).
            route_call = self._route_chain(obj)
            if route_call is not None and prop in HTTP_VERBS + ("all",):
                base, path = route_call
                if base in routers:
                    self._express_route(base, prop, path, argv, node)
                continue
            if obj is None or obj.type != "identifier" or _text(obj) not in routers:
                continue
            var = _text(obj)
            if var in self.param_routers and not self.imports_express and prop != "use" and \
                    not (argv and (js_string(argv[0]) or "").startswith("/")):
                continue  # an untyped `app`/`router` parameter only counts with a '/path'
            if prop == "use":
                self._express_mount(var, argv, node)
            elif prop in HTTP_VERBS + ("all",) and argv:
                path = js_string(argv[0])
                if path is None or len(argv) < 2:
                    continue  # app.get('setting') is a settings read, not a route
                self._express_route(var, prop, path, argv[1:], node)

    def _pass_router(self, call: Node, fn: Node | None, passable: set[str]) -> None:
        """`require('./routes')(app)` / `registerRoutes(app)`: a router handed to a
        function, whose parameter then is that router."""
        if fn is None:
            return
        spec = self._require_spec(fn)
        callee = f"require:{spec}" if spec is not None else \
            _text(fn) if fn.type in ("identifier", "member_expression") else None
        if callee is None or callee == "require":
            return
        args = call.child_by_field_name("arguments")
        for i, a in enumerate(args.named_children if args is not None else []):
            if a.type == "identifier" and _text(a) in passable:
                self.f.mounts.append(Mount("pass", _text(a), callee, "", _line(call), arg=i))

    def _route_chain(self, obj: Node | None) -> tuple[str, str] | None:
        """For `X.route('/p').get(...)…`, the router variable and path."""
        while obj is not None and obj.type == "call_expression":
            fn = obj.child_by_field_name("function")
            if fn is None or fn.type != "member_expression":
                return None
            inner = fn.child_by_field_name("object")
            if _text(fn.child_by_field_name("property")) == "route" and inner is not None \
                    and inner.type == "identifier":
                args = obj.child_by_field_name("arguments")
                first = args.named_children[0] if args is not None and args.named_children else None
                path = js_string(first)
                return (_text(inner), path) if path is not None else None
            obj = inner
        return None

    def _express_route(self, var: str, verb: str, path: str, handlers: list[Node],
                       call: Node) -> None:
        method = "ANY" if verb == "all" else verb.upper()
        handler = handlers[-1] if handlers else None
        route = RouteDecl("express", [method], path, _line(call), router=var)
        if handler is not None and handler.type in JS_FUNCTION_VALUES:
            self.f.functions.append(Function(f"{method} {path}", None, _line(handler),
                                             _end_line(handler),
                                             _js_params(handler.child_by_field_name("parameters")),
                                             synthetic=True))
            route.handler_fn = len(self.f.functions) - 1
            route.handler_label = "inline handler"
        elif handler is not None:
            route.handler_ref = _text(handler)
            route.handler_label = _text(handler)
        self.f.routes.append(route)

    def _express_mount(self, var: str, argv: list[Node], call: Node) -> None:
        if not argv:
            return
        prefix = js_string(argv[0])
        children = argv[1:] if prefix is not None else argv
        if not children:
            return
        target = children[-1]
        spec = self._require_spec(target)
        if spec is not None:
            ref = f"require:{spec}"
        elif target.type in ("identifier", "member_expression"):
            ref = _text(target)
        else:
            # An inline router: `.use('/v1', Router().get('/ping', h))`.
            ref = f"<router@{_line(target)}:{target.start_point[1]}>"
            kind = self._router_expr(ref, target)
            if kind is None:
                return
            self.f.routers.append(RouterDecl(ref, kind, "express", line=_line(target)))
        self.f.mounts.append(Mount("express", var, ref, prefix or "", _line(call)))

    # NestJS
    def _nest(self) -> None:
        for node in _walk(self.root):
            if node.type not in ("class_declaration", "abstract_class_declaration"):
                continue
            decorators = list(_named(node, "decorator"))
            if node.parent is not None and node.parent.type == "export_statement":
                decorators += _named(node.parent, "decorator")
            prefixes = None
            for d in decorators:
                name, args = self._decorator(d)
                if name == "Controller":
                    prefixes = self._nest_paths(args)
            if prefixes is None:
                continue
            cls = _text(node.child_by_field_name("name"))
            body = node.child_by_field_name("body")
            pending: list[Node] = []
            for m in (body.named_children if body is not None else []):
                if m.type == "decorator":
                    pending.append(m)
                    continue
                if m.type == "method_definition":
                    name = _text(m.child_by_field_name("name"))
                    for d in pending:
                        dname, dargs = self._decorator(d)
                        if dname is None or dname.lower() not in HTTP_VERBS + ("all",):
                            continue
                        method = "ANY" if dname == "All" else dname.upper()
                        fn_idx = next((i for i, f in enumerate(self.f.functions)
                                       if f.owner == cls and f.name == name
                                       and f.line == _line(m)), None)
                        for prefix in prefixes:
                            for sub in self._nest_paths(dargs):
                                self.f.routes.append(RouteDecl(
                                    "nestjs", [method], join_path(prefix, sub), _line(m),
                                    handler_fn=fn_idx, handler_label=f"{cls}.{name}"))
                pending = []

    @staticmethod
    def _decorator(d: Node) -> tuple[str | None, list[Node]]:
        inner = d.named_children[0] if d.named_children else None
        if inner is None:
            return None, []
        if inner.type == "call_expression":
            fn = inner.child_by_field_name("function")
            args = inner.child_by_field_name("arguments")
            return _text(fn), (args.named_children if args is not None else [])
        return _text(inner), []

    @staticmethod
    def _nest_paths(args: list[Node]) -> list[str]:
        if not args:
            return [""]
        a = args[0]
        if a.type in ("string", "template_string"):
            return [js_string(a) or ""]
        if a.type == "array":
            return [js_string(x) if x.type in ("string", "template_string") else _placeholder(x)
                    for x in a.named_children] or [""]
        if a.type == "object":  # @Controller({ path: 'x', host: … })
            for p in _named(a, "pair"):
                if _text(p.child_by_field_name("key")) == "path":
                    return _Js._nest_paths([p.child_by_field_name("value")])
            return [""]
        return [_placeholder(a)]


# --- Python --------------------------------------------------------------------------

def _py_type(node: Node | None) -> str | None:
    if node is None:
        return None
    if node.type == "type":
        node = node.named_children[0] if node.named_children else None
        if node is None:
            return None
    if node.type in ("identifier", "attribute"):
        return _text(node)
    if node.type in ("generic_type", "subscript"):
        inner = node.named_children[0] if node.named_children else None
        return _py_type(inner)
    if node.type == "string":  # forward reference: 'Repo'
        return py_string(node)
    return None


def _py_params(params: Node | None) -> list[Param]:
    out: list[Param] = []
    if params is None:
        return out
    for p in params.named_children:
        if p.type == "identifier":
            out.append(Param(_text(p)))
        elif p.type == "typed_parameter":
            ident = _first(p, "identifier")
            out.append(Param(_text(ident), _py_type(p.child_by_field_name("type"))))
        elif p.type == "default_parameter":
            out.append(Param(_text(p.child_by_field_name("name"))))
        elif p.type == "typed_default_parameter":
            out.append(Param(_text(p.child_by_field_name("name")),
                             _py_type(p.child_by_field_name("type"))))
    return out


def _call_name(node: Node | None) -> str | None:
    if node is None or node.type != "call":
        return None
    return _text(node.child_by_field_name("function"))


def _kwargs(call: Node) -> dict[str, Node]:
    args = call.child_by_field_name("arguments")
    out = {}
    for a in (args.named_children if args is not None else []):
        if a.type == "keyword_argument":
            out[_text(a.child_by_field_name("name"))] = a.child_by_field_name("value")
    return out


def _positional(call: Node) -> list[Node]:
    args = call.child_by_field_name("arguments")
    return [a for a in (args.named_children if args is not None else [])
            if a.type not in ("keyword_argument", "comment", "list_splat", "dictionary_splat")]


def _py_piece(node: Node) -> str:
    """A path piece: the literal, or `{expr}` for a setting or variable."""
    s = py_string(node)
    return s if s is not None else _placeholder(node)


PY_ROUTER_CTORS = {
    "Flask": ("flask-app", "flask"), "flask.Flask": ("flask-app", "flask"),
    "Blueprint": ("blueprint", "flask"), "flask.Blueprint": ("blueprint", "flask"),
    "FastAPI": ("fastapi-app", "fastapi"), "fastapi.FastAPI": ("fastapi-app", "fastapi"),
    "APIRouter": ("apirouter", "fastapi"), "fastapi.APIRouter": ("apirouter", "fastapi"),
}
DRF_ROUTER_CTORS = ("DefaultRouter", "SimpleRouter", "routers.DefaultRouter",
                    "routers.SimpleRouter")


class _Py:
    def __init__(self, root: Node, path: str):
        self.root = root
        self.path = path
        self.f = FlowFacts()
        self.modules: set[str] = set()  # top-level modules imported (flask, fastapi, …)
        self.fn_at: dict[int, int] = {}  # function node start byte → index

    def run(self) -> FlowFacts:
        self._imports()
        self._exports()
        self._functions(self.root, None, None)
        self._routers()
        self._routes()
        self._django()
        return self.f

    def _imports(self) -> None:
        for node in _walk(self.root):
            if node.type == "import_statement":
                for n in node.children_by_field_name("name"):
                    if n.type == "aliased_import":
                        mod = _text(n.child_by_field_name("name"))
                        self.f.bindings.append(Binding(_text(n.child_by_field_name("alias")),
                                                       "module", mod))
                    else:
                        mod = _text(n)
                        # `import a.b` binds `a`; attribute access walks the rest.
                        self.f.bindings.append(Binding(mod.split(".")[0], "module",
                                                       mod.split(".")[0]))
                    self.modules.add(mod.split(".")[0])
            elif node.type == "import_from_statement":
                mod_node = node.child_by_field_name("module_name")
                dots, module = 0, ""
                if mod_node is not None and mod_node.type == "relative_import":
                    for c in mod_node.named_children:
                        if c.type == "import_prefix":
                            dots = len(_text(c).strip())
                        elif c.type == "dotted_name":
                            module = _text(c)
                else:
                    module = _text(mod_node)
                if module and not dots:
                    self.modules.add(module.split(".")[0])
                if any(c.type == "wildcard_import" for c in node.named_children):
                    self.f.bindings.append(Binding("*", "star", module, dots=dots))
                    continue
                for n in node.children_by_field_name("name"):
                    if n.type == "aliased_import":
                        name = _text(n.child_by_field_name("name"))
                        local = _text(n.child_by_field_name("alias"))
                    else:
                        name = local = _text(n)
                    self.f.bindings.append(Binding(local, "named", module, name, dots=dots))

    def _exports(self) -> None:
        names: list[str] = []
        all_list: list[str] | None = None
        for node in self.root.named_children:
            target = node.child_by_field_name("definition") \
                if node.type == "decorated_definition" else node
            if target is not None and target.type in ("function_definition", "class_definition"):
                names.append(_text(target.child_by_field_name("name")))
            elif node.type == "expression_statement" and node.named_children:
                a = node.named_children[0]
                if a.type == "assignment":
                    left = a.child_by_field_name("left")
                    right = a.child_by_field_name("right")
                    if left is not None and left.type == "identifier":
                        if _text(left) == "__all__" and right is not None \
                                and right.type in ("list", "tuple"):
                            all_list = [s for s in (py_string(x) for x in right.named_children) if s]
                        else:
                            names.append(_text(left))
        if all_list is not None:
            names = [n for n in names if n in all_list] + [
                n for n in all_list if n not in names]  # re-exported imports
        self.f.exports = [Export(n, n) for n in names]

    def _functions(self, node: Node, owner: str | None, scope: str | None) -> None:
        for c in node.named_children:
            target = c.child_by_field_name("definition") if c.type == "decorated_definition" else c
            if target is None:
                continue
            if target.type == "class_definition":
                cls = _text(target.child_by_field_name("name"))
                body = target.child_by_field_name("body")
                if body is not None:
                    self._class_members(cls, body)
                    self._functions(body, cls, None)
                continue
            if target.type == "function_definition":
                name = _text(target.child_by_field_name("name"))
                static = c.type == "decorated_definition" and any(
                    _text(d).lstrip("@").strip() in ("staticmethod", "classmethod")
                    for d in _named(c, "decorator"))
                self.f.functions.append(Function(
                    name, owner, _line(c), _end_line(target),
                    _py_params(target.child_by_field_name("parameters")), static, scope,
                    action=self._drf_action(c) if c.type == "decorated_definition" else None))
                self.fn_at[target.start_byte] = len(self.f.functions) - 1
                body = target.child_by_field_name("body")
                if body is not None:
                    # Nested defs belong to no class; `scope` records the enclosing def.
                    self._functions(body, None, name)
                    if owner is not None:
                        self._self_members(owner, body)
                continue
            if c.type in ("if_statement", "try_statement", "with_statement", "block",
                          "else_clause", "elif_clause", "except_clause", "finally_clause"):
                self._functions(c, owner, scope)

    @staticmethod
    def _drf_action(node: Node) -> dict | None:
        for d in _named(node, "decorator"):
            call = d.named_children[0] if d.named_children else None
            if call is None or call.type != "call" or _call_name(call) not in (
                    "action", "decorators.action"):
                continue
            kw = _kwargs(call)
            methods_node = kw.get("methods")
            methods = [m.upper() for m in (py_string(x) for x in methods_node.named_children)
                       if m] if methods_node is not None and methods_node.type in (
                "list", "tuple") else ["GET"]
            return {"detail": _text(kw.get("detail")) == "True", "methods": methods,
                    "url_path": py_string(kw.get("url_path"))}
        return None

    def _class_members(self, cls: str, body: Node) -> None:
        for stmt in _named(body, "expression_statement"):
            a = stmt.named_children[0] if stmt.named_children else None
            if a is not None and a.type == "assignment":
                left, t = a.child_by_field_name("left"), _py_type(a.child_by_field_name("type"))
                if left is not None and left.type == "identifier" and t:
                    self.f.members.append(Member(cls, _text(left), t))

    def _self_members(self, cls: str, body: Node) -> None:
        for node in _walk(body):
            if node.type != "assignment":
                continue
            left = node.child_by_field_name("left")
            if left is None or left.type != "attribute" or \
                    _text(left.child_by_field_name("object")) != "self":
                continue
            name = _text(left.child_by_field_name("attribute"))
            t = _py_type(node.child_by_field_name("type")) or _call_name(
                node.child_by_field_name("right"))
            if t and not any(m.owner == cls and m.name == name for m in self.f.members):
                self.f.members.append(Member(cls, name, t))

    # Flask / FastAPI
    def _routers(self) -> None:
        for node in _walk(self.root):
            if node.type != "assignment":
                continue
            left, right = node.child_by_field_name("left"), node.child_by_field_name("right")
            ctor = _call_name(right)
            if left is None or left.type != "identifier" or ctor is None:
                continue
            if ctor in PY_ROUTER_CTORS:
                kind, fw = PY_ROUTER_CTORS[ctor]
                kw = _kwargs(right)
                pnode = kw.get("url_prefix" if fw == "flask" else "prefix")
                prefix = _py_piece(pnode) if pnode is not None else ""
                self.f.routers.append(RouterDecl(_text(left), kind, fw, prefix, _line(node)))
            elif ctor in DRF_ROUTER_CTORS:
                self.f.drf_routers.append(_text(left))
                if _text(_kwargs(right).get("trailing_slash")) == "False":
                    self.f.drf_no_slash.append(_text(left))
        # app/router passed in as a parameter: `def register(app): @app.get(…)`.
        fw = "flask" if "flask" in self.modules else "fastapi" if "fastapi" in self.modules \
            else None
        if fw is None:
            return
        for node in _walk(self.root):
            if node.type != "function_definition":
                continue
            for p in _py_params(node.child_by_field_name("parameters")):
                kind = None
                if p.type in ("Flask", "flask.Flask", "Blueprint", "FastAPI", "APIRouter"):
                    kind = "param"
                elif p.name in ("app", "bp", "blueprint", "router", "api"):
                    kind = "param"
                if kind and not any(r.var == p.name for r in self.f.routers):
                    self.f.routers.append(RouterDecl(p.name, kind, fw, "", _line(node)))

    def _router_framework(self, var: str) -> str | None:
        r = next((r for r in self.f.routers if r.var == var), None)
        if r is not None:
            return r.framework
        # Imported from another file (`from app import app`): decided at link time,
        # but only in a file that imports one of the frameworks.
        if any(b.local == var for b in self.f.bindings):
            return "flask" if "flask" in self.modules else \
                "fastapi" if "fastapi" in self.modules else "py-imported"
        return None

    def _routes(self) -> None:
        for node in _walk(self.root):
            if node.type == "decorated_definition":
                self._decorated(node)
            elif node.type == "call":
                self._py_call(node)

    def _decorated(self, node: Node) -> None:
        target = node.child_by_field_name("definition")
        if target is None or target.type != "function_definition":
            return
        fn_idx = self.fn_at.get(target.start_byte)
        name = _text(target.child_by_field_name("name"))
        for d in _named(node, "decorator"):
            call = d.named_children[0] if d.named_children else None
            if call is None or call.type != "call":
                continue
            fn = call.child_by_field_name("function")
            if fn is None or fn.type != "attribute":
                continue
            var = _text(fn.child_by_field_name("object"))
            verb = _text(fn.child_by_field_name("attribute"))
            fw = self._router_framework(var)
            if fw is None:
                continue
            pos = _positional(call)
            path = py_string(pos[0]) if pos else py_string(_kwargs(call).get("path")) \
                if "path" in _kwargs(call) else None
            if path is None:
                path = py_string(_kwargs(call).get("rule"))
            if path is None:
                continue
            if verb == "route" or verb == "api_route":
                methods_node = _kwargs(call).get("methods")
                methods = [m.upper() for m in (py_string(x) for x in methods_node.named_children)
                           if m] if methods_node is not None and methods_node.type in (
                    "list", "tuple", "set") else []
                if not methods:
                    methods = ["GET"] if verb == "route" else ["ANY"]
            elif verb in HTTP_VERBS:
                methods = [verb.upper()]
            else:
                continue
            # 'py-imported': the router variable comes from another file; link time keeps
            # the route only if that variable really is a Flask/FastAPI app or router.
            self.f.routes.append(RouteDecl(fw, methods, path, _line(node), router=var,
                                           handler_fn=fn_idx, handler_label=name))

    def _py_call(self, node: Node) -> None:
        fn = node.child_by_field_name("function")
        if fn is not None and fn.type in ("identifier", "attribute"):
            self._pass_router(node, _text(fn))
        if fn is None or fn.type != "attribute":
            return
        var = _text(fn.child_by_field_name("object"))
        attr = _text(fn.child_by_field_name("attribute"))
        pos, kw = _positional(node), _kwargs(node)
        if attr == "register_blueprint" and pos:
            prefix = _py_piece(kw["url_prefix"]) if "url_prefix" in kw else None
            self.f.mounts.append(Mount("flask", var, _text(pos[0]), prefix, _line(node)))
        elif attr == "include_router" and pos:
            prefix = _py_piece(kw["prefix"]) if "prefix" in kw else ""
            self.f.mounts.append(Mount("fastapi", var, _text(pos[0]), prefix, _line(node)))
        elif attr == "register" and var in self.f.drf_routers and len(pos) >= 2:
            prefix = py_string(pos[0])
            if prefix is not None:
                self.f.drf.append(DrfRegistration(var, prefix, _text(pos[1]), _line(node)))
        elif attr == "add_url_rule" and pos:
            rule = py_string(pos[0])
            view = kw.get("view_func") or (pos[2] if len(pos) > 2 else None)
            fw = self._router_framework(var)
            if rule is None or view is None or fw not in ("flask", "py-imported"):
                return
            methods_node = kw.get("methods")
            methods = [m.upper() for m in (py_string(x) for x in methods_node.named_children)
                       if m] if methods_node is not None and methods_node.type in (
                "list", "tuple") else []
            route = RouteDecl("flask", methods or ["GET"], rule, _line(node), router=var)
            as_view = self._as_view(view)
            if as_view is not None:
                route.handler_ref = f"{as_view}.as_view"
                route.handler_label = f"{as_view}.as_view()"
                route.methods = methods or ["CLASS"]  # filled in from the class at link time
            else:
                route.handler_ref = _text(view)
                route.handler_label = _text(view)
            self.f.routes.append(route)

    def _pass_router(self, call: Node, callee: str) -> None:
        candidates = {r.var for r in self.f.routers} | {b.local for b in self.f.bindings}
        for i, a in enumerate(_positional(call)):
            if a.type == "identifier" and _text(a) in candidates:
                self.f.mounts.append(Mount("pass", _text(a), callee, "", _line(call), arg=i))

    @staticmethod
    def _as_view(node: Node) -> str | None:
        if node.type == "call":
            fn = node.child_by_field_name("function")
            if fn is not None and fn.type == "attribute" and \
                    _text(fn.child_by_field_name("attribute")) == "as_view":
                return _text(fn.child_by_field_name("object"))
        return None

    # Django
    def _django(self) -> None:
        for node in self.root.named_children:
            if node.type != "expression_statement" or not node.named_children:
                continue
            a = node.named_children[0]
            if a.type == "assignment":
                left, right = a.child_by_field_name("left"), a.child_by_field_name("right")
                if _text(left) == "ROOT_URLCONF":
                    self.f.root_urlconf = py_string(right)
                elif _text(left) == "urlpatterns" and right is not None:
                    self._urlpatterns(right)
            elif a.type == "augmented_assignment" and _text(a.child_by_field_name("left")) \
                    == "urlpatterns":
                self._urlpatterns(a.child_by_field_name("right"))

    def _urlpatterns(self, node: Node | None) -> None:
        if node is None:
            return
        if node.type == "binary_operator":  # [...] + router.urls
            self._urlpatterns(node.child_by_field_name("left"))
            self._urlpatterns(node.child_by_field_name("right"))
            return
        if node.type == "attribute" and _text(node.child_by_field_name("attribute")) == "urls":
            self.f.router_urls_appended.append(_text(node.child_by_field_name("object")))
            return
        if node.type in ("list", "tuple"):
            self.f.urlpatterns.extend(p for p in (self._pattern(x) for x in node.named_children)
                                      if p is not None)

    def _pattern(self, call: Node) -> UrlPattern | None:
        name = _call_name(call)
        if name not in ("path", "re_path", "url", "django.urls.path", "django.urls.re_path"):
            return None
        pos = _positional(call)
        if len(pos) < 2:
            return None
        route = py_string(pos[0])
        if route is None:
            route = _placeholder(pos[0])
        p = UrlPattern(route, _line(call), regex=name in ("re_path", "url",
                                                         "django.urls.re_path"))
        view = pos[1]
        inc = _call_name(view)
        if inc in ("include", "django.urls.include"):
            args = _positional(view)
            if args:
                a = args[0]
                if a.type == "tuple" and a.named_children:  # include(('app.urls', 'ns'))
                    a = a.named_children[0]
                if py_string(a) is not None:
                    p.include_module = py_string(a)
                elif a.type == "attribute" and _text(a.child_by_field_name("attribute")) == "urls":
                    p.include_router = _text(a.child_by_field_name("object"))
                elif a.type in ("list", "tuple"):
                    p.include_list = [x for x in (self._pattern(c) for c in a.named_children)
                                      if x is not None]
            return p
        if view.type == "attribute" and _text(view.child_by_field_name("attribute")) == "urls":
            # include(router.urls) written without include(); a DRF router in this file, or
            # a library URLconf such as admin.site.urls, whose routes aren't listed.
            obj = _text(view.child_by_field_name("object"))
            if "." in obj:
                p.external_urls = True
            else:
                p.include_router = obj
            return p
        cls = self._as_view(view)
        if cls is not None:
            p.view_class = cls
        else:
            p.view = _text(view)
        return p


# --- Java ----------------------------------------------------------------------------

def _java_type(node: Node | None) -> str | None:
    if node is None:
        return None
    if node.type == "generic_type":
        inner = _first(node, "type_identifier", "scoped_type_identifier")
        return _text(inner) if inner is not None else None
    if node.type in ("type_identifier", "scoped_type_identifier"):
        return _text(node)
    return None


def _annotations(node: Node) -> list[tuple[str, Node | None]]:
    mods = _first(node, "modifiers")
    out = []
    for a in (mods.named_children if mods is not None else []):
        if a.type in ("annotation", "marker_annotation"):
            out.append((_text(a.child_by_field_name("name")).rsplit(".", 1)[-1],
                        a.child_by_field_name("arguments")))
    return out


def _java_values(node: Node | None) -> list[str]:
    """String values of an annotation element: "x", {"a", "b"}, or a constant."""
    if node is None:
        return []
    if node.type == "element_value_array_initializer":
        return [v for c in node.named_children for v in _java_values(c)]
    s = java_string(node)
    if s is not None:
        return [s]
    if node.type in ("identifier", "field_access", "binary_expression"):
        return [_placeholder(node)]
    return []


def _ann_element(args: Node | None, *keys: str) -> Node | None:
    """An annotation's element by key, or the bare positional value for `value`."""
    if args is None:
        return None
    for c in args.named_children:
        if c.type == "element_value_pair":
            if _text(c.child_by_field_name("key")) in keys:
                return c.child_by_field_name("value")
        elif "value" in keys:
            return c
    return None


SPRING_VERBS = {"GetMapping": "GET", "PostMapping": "POST", "PutMapping": "PUT",
                "DeleteMapping": "DELETE", "PatchMapping": "PATCH"}


class _Java:
    def __init__(self, root: Node):
        self.root = root
        self.f = FlowFacts()

    def run(self) -> FlowFacts:
        for node in self.root.named_children:
            if node.type == "package_declaration":
                ident = _first(node, "scoped_identifier", "identifier")
                self.f.package = _text(ident) if ident is not None else None
            elif node.type == "import_declaration":
                self._import(node)
            elif node.type in ("class_declaration", "interface_declaration", "enum_declaration",
                               "record_declaration"):
                self.f.exports.append(Export(_text(node.child_by_field_name("name")),
                                             _text(node.child_by_field_name("name"))))
                self._type(node, None)
        return self.f

    def _import(self, node: Node) -> None:
        name = next((_text(c) for c in node.named_children
                     if c.type in ("scoped_identifier", "identifier")), "")
        if not name:
            return
        wildcard = any(c.type == "asterisk" for c in node.named_children)
        static = any(c.type == "static" for c in node.children)
        if static:
            if wildcard:
                self.f.bindings.append(Binding("*", "star", name))
            else:
                cls, member = name.rsplit(".", 1)
                self.f.bindings.append(Binding(member, "static", cls, member))
        elif wildcard:
            self.f.bindings.append(Binding("*", "package", name))
        else:
            self.f.bindings.append(Binding(name.rsplit(".", 1)[-1], "named", name,
                                           name.rsplit(".", 1)[-1]))

    def _type(self, node: Node, outer: str | None) -> None:
        cls = _text(node.child_by_field_name("name"))
        body = node.child_by_field_name("body")
        if body is None:
            return
        anns = dict(_annotations(node))
        is_controller = "RestController" in anns or "Controller" in anns
        prefixes = [""]
        if is_controller and "RequestMapping" in anns:
            prefixes = _java_values(_ann_element(anns["RequestMapping"], "value", "path")) or [""]
        if node.type == "record_declaration":
            params = node.child_by_field_name("parameters")
            for p in (params.named_children if params is not None else []):
                t = _java_type(p.child_by_field_name("type"))
                if t:
                    self.f.members.append(Member(cls, _text(p.child_by_field_name("name")), t))
        for m in body.named_children:
            if m.type in ("class_declaration", "interface_declaration", "enum_declaration",
                          "record_declaration"):
                self._type(m, cls)
            elif m.type == "field_declaration":
                t = _java_type(m.child_by_field_name("type"))
                for d in m.children_by_field_name("declarator"):
                    if t:
                        self.f.members.append(Member(cls, _text(d.child_by_field_name("name")), t))
            elif m.type in ("method_declaration", "constructor_declaration"):
                params = []
                ps = m.child_by_field_name("parameters")
                for p in (ps.named_children if ps is not None else []):
                    if p.type in ("formal_parameter", "spread_parameter"):
                        params.append(Param(_text(p.child_by_field_name("name")) or
                                            _text(_first(p, "variable_declarator")),
                                            _java_type(p.child_by_field_name("type"))))
                mods = _first(m, "modifiers")
                static = mods is not None and any(c.type == "static" for c in mods.children)
                name = _text(m.child_by_field_name("name"))
                self.f.functions.append(Function(name, cls, _line(m), _end_line(m), params,
                                                 static))
                idx = len(self.f.functions) - 1
                if m.type == "constructor_declaration":
                    continue
                if is_controller:
                    self._spring_route(cls, name, m, idx, prefixes)

    def _spring_route(self, cls: str, name: str, m: Node, idx: int, prefixes: list[str]) -> None:
        for ann, args in _annotations(m):
            if ann in SPRING_VERBS:
                methods = [SPRING_VERBS[ann]]
            elif ann == "RequestMapping":
                mnode = _ann_element(args, "method")
                methods = [v.rsplit(".", 1)[-1].strip("{}") for v in _java_values(mnode)] \
                    if mnode is not None else []
                if mnode is not None and not methods:
                    methods = [_text(x).rsplit(".", 1)[-1] for x in
                               (mnode.named_children if mnode.type ==
                                "element_value_array_initializer" else [mnode])]
                methods = methods or ["ANY"]
            else:
                continue
            paths = _java_values(_ann_element(args, "value", "path")) or [""]
            for prefix in prefixes:
                for p in paths:
                    self.f.routes.append(RouteDecl("spring", methods, join_path(prefix, p),
                                                   _line(m), handler_fn=idx,
                                                   handler_label=f"{cls}.{name}"))


# --- shared --------------------------------------------------------------------------

def join_path(*parts: str) -> str:
    """Joins route pieces with single slashes and a leading one. A trailing slash on
    the last non-empty piece is kept (Django and Flask treat it as meaningful)."""
    pieces = [p for p in parts if p]
    if not pieces:
        return "/"
    trailing = pieces[-1].endswith("/") and pieces[-1] != "/"
    body = "/".join(p.strip("/") for p in pieces if p.strip("/"))
    out = "/" + body
    if trailing and not out.endswith("/"):
        out += "/"
    return out


def extract_flows(lang: str, path: str, root: Node) -> FlowFacts:
    if lang in ("js", "ts"):
        return _Js(root).run()
    if lang == "py":
        return _Py(root, path).run()
    if lang == "java":
        return _Java(root).run()
    return FlowFacts()
