"""Cross-file step for the APIs view, run once every file is parsed: resolves each
file's import bindings to repo files, composes router / blueprint / include prefixes,
and turns route declarations into final endpoints.

Resolution is strict. A binding resolves only to the exact module or file its import
names; a symbol is found only through that file's own definitions or exports (and
re-exports, a few hops deep). Anything ambiguous or outside the repo stays unresolved
rather than being matched by name elsewhere.

Every endpoint carries `prefix`:
- 'root': declared on the application itself (Spring/Nest controllers, an Express or
  Flask/FastAPI app, a Django ROOT_URLCONF).
- 'resolved': on a router/blueprint/urls module whose every mount up to an app was found.
- 'unknown': the router was never seen mounted, or a mount couldn't be resolved, so the
  path shown is relative to it.
"""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import asdict
from typing import Protocol

from call_resolve import CallResolver
from query_link import QueryLinker
from flows import FlowFacts, Mount, RouteDecl, UrlPattern, join_path
from resolve import JS_ALIAS_PREFIXES, _JavaResolver, _JsResolver

MAX_HOPS = 5  # re-export / binding chains
MAX_PREFIXES = 5  # mount variants per router
MAX_DEPTH = 8  # mount nesting

APP_KINDS = ("express-app", "flask-app", "fastapi-app")

# Django and DRF class-based views: the HTTP methods a base class handles by itself.
VIEW_BASES: dict[str, tuple[str, ...]] = {
    "TemplateView": ("GET",), "ListView": ("GET",), "DetailView": ("GET",),
    "RedirectView": ("GET",), "ArchiveIndexView": ("GET",),
    "FormView": ("GET", "POST"), "CreateView": ("GET", "POST"),
    "UpdateView": ("GET", "POST"), "DeleteView": ("GET", "POST"),
    "LoginView": ("GET", "POST"), "LogoutView": ("POST",),
    "ListAPIView": ("GET",), "RetrieveAPIView": ("GET",), "CreateAPIView": ("POST",),
    "UpdateAPIView": ("PUT", "PATCH"), "DestroyAPIView": ("DELETE",),
    "ListCreateAPIView": ("GET", "POST"), "RetrieveUpdateAPIView": ("GET", "PUT", "PATCH"),
    "RetrieveDestroyAPIView": ("GET", "DELETE"),
    "RetrieveUpdateDestroyAPIView": ("GET", "PUT", "PATCH", "DELETE"),
}
HTTP_METHOD_NAMES = ("get", "post", "put", "patch", "delete", "options", "head")

# DRF viewsets: base class → actions it provides; action → (method, detail route?).
VIEWSET_BASES: dict[str, tuple[str, ...]] = {
    "ModelViewSet": ("list", "create", "retrieve", "update", "partial_update", "destroy"),
    "ReadOnlyModelViewSet": ("list", "retrieve"),
    "ListModelMixin": ("list",), "CreateModelMixin": ("create",),
    "RetrieveModelMixin": ("retrieve",), "UpdateModelMixin": ("update", "partial_update"),
    "DestroyModelMixin": ("destroy",),
}
VIEWSET_ACTIONS = {"list": ("GET", False), "create": ("POST", False),
                   "retrieve": ("GET", True), "update": ("PUT", True),
                   "partial_update": ("PATCH", True), "destroy": ("DELETE", True)}


class FlowFile(Protocol):  # inventory.FileRecord
    path: str
    lang: str
    flows: FlowFacts


def _simple(name: str) -> str:
    return name.rsplit(".", 1)[-1]


class Linker:
    def __init__(self, files: Sequence[FlowFile], types_by_file: Sequence[list] | None = None):
        self.files = files
        self.by_path = {f.path: i for i, f in enumerate(files)}
        self.js = _JsResolver(files)  # type: ignore[arg-type]
        self.java = _JavaResolver(files)  # type: ignore[arg-type]
        self.types = types_by_file or [[] for _ in files]
        # Python: dotted module → file, from the repo root (as resolve.py does).
        self.py_modules: dict[str, int] = {}
        for i, f in enumerate(files):
            if f.lang != "py":
                continue
            parts = f.path[: -len(".py")].split("/")
            if parts[-1] == "__init__":
                parts = parts[:-1]
            if parts:
                self.py_modules.setdefault(".".join(parts), i)
        # Every dotted suffix of each module, for absolute imports written relative to
        # a source root below the repo root (`from app.api import x` in backend/app/…).
        self.py_suffixes: dict[str, list[int]] = defaultdict(list)
        for mod, i in self.py_modules.items():
            parts = mod.split(".")
            for k in range(1, len(parts)):
                self.py_suffixes[".".join(parts[k:])].append(i)
        self.bindings = [self._resolve_bindings(i) for i in range(len(files))]

    # --- bindings ----------------------------------------------------------------------

    def _js_target(self, importer: str, spec: str) -> int | None:
        """Relative and alias specifiers resolve as imports do. A bare specifier is a
        package unless it has a path and exactly one repo file ends with it."""
        if spec.startswith(("./", "../")) or spec in (".", ".."):
            return self.js.resolve(importer, spec)
        if spec.startswith(JS_ALIAS_PREFIXES):
            return self.js.resolve(importer, spec)
        if "/" not in spec or (spec.startswith("@") and not spec.startswith("@/")):
            return None
        hits = self.js.by_suffix.get(spec.strip("/"))
        return hits[0] if hits and len(hits) == 1 else None

    def _py_module(self, importer: str, dots: int, module: str) -> str | None:
        if not dots:
            return module
        base = importer.split("/")[:-1]
        up = dots - 1
        if up > len(base):
            return None
        base = base[: len(base) - up]
        return ".".join(base + ([module] if module else [])) or None

    def _resolve_bindings(self, i: int) -> list[dict]:
        f = self.files[i]
        out = []
        for b in f.flows.bindings:
            target: str | None = None
            kind, name = b.kind, b.name
            if f.lang in ("js", "ts"):
                hit = self._js_target(f.path, b.spec)
                target = self.files[hit].path if hit is not None else None
            elif f.lang == "py":
                mod = self._py_module(f.path, b.dots, b.spec)
                if mod is not None:
                    sub = self.py_file(f"{mod}.{name}", b.dots) if kind == "named" else None
                    if sub is not None:
                        kind, target, name = "module", self.files[sub].path, None
                    else:
                        hit = self.py_file(mod, b.dots)
                        target = self.files[hit].path if hit is not None else None
            elif f.lang == "java":
                if kind == "package":
                    target = b.spec if b.spec in self.java.packages else None
                else:
                    hit = self.java.classes.get(b.spec)
                    target = self.files[hit].path if hit is not None else None
                    if kind == "static":
                        name = f"{_simple(b.spec)}.{b.name}"
            out.append({"local": b.local, "kind": kind, "target": target, "name": name,
                        "typeOnly": b.type_only})
        return out

    def py_file(self, module: str, dots: int = 0) -> int | None:
        """The file for a dotted module: exact from the repo root, else (absolute
        imports only) the one module whose path ends with it — none if several do."""
        hit = self.py_modules.get(module)
        if hit is not None or dots:
            return hit
        hits = self.py_suffixes.get(module, [])
        return hits[0] if len(hits) == 1 else None

    def binding(self, i: int, local: str) -> dict | None:
        return next((b for b in self.bindings[i] if b["local"] == local), None)

    # --- symbols -----------------------------------------------------------------------

    def find_symbol(self, i: int, name: str, hops: int = 0) -> tuple[int, str] | None:
        """The file and local name that `name`, as exported by file `i`, refers to.
        None when it isn't found or is ambiguous (two `export *` sources)."""
        if hops > MAX_HOPS:
            return None
        f = self.files[i]
        if f.lang in ("js", "ts"):
            for e in f.flows.exports:
                if e.name == name and e.local is not None:
                    return self.local_symbol(i, e.local, hops)
                if e.name == name and e.spec is not None and e.from_name not in (None, "*"):
                    t = self._js_target(f.path, e.spec)
                    return self.find_symbol(t, e.from_name, hops + 1) if t is not None else None
            hits = []
            for e in f.flows.exports:
                if e.name == "*" and e.spec is not None:
                    t = self._js_target(f.path, e.spec)
                    hit = self.find_symbol(t, name, hops + 1) if t is not None else None
                    if hit is not None:
                        hits.append(hit)
            return hits[0] if len(hits) == 1 else None
        # Python and Java: what the file defines, or (Python) re-exports by importing.
        return self.local_symbol(i, name, hops)

    def local_symbol(self, i: int, name: str, hops: int = 0) -> tuple[int, str] | None:
        """`name` as seen inside file `i`: defined there, else through its binding."""
        f = self.files[i]
        if self._defines(i, name):
            return i, name
        b = self.binding(i, name)
        if b is None or b["target"] is None or f.lang == "java":
            return None
        t = self.by_path.get(b["target"])
        if t is None:
            return None
        if b["kind"] in ("named", "default"):
            return self.find_symbol(t, b["name"] or name, hops + 1)
        if b["kind"] == "require":  # CommonJS: the value is module.exports
            return self.find_symbol(t, "default", hops + 1)
        return None

    def _defines(self, i: int, name: str) -> bool:
        f = self.files[i].flows
        if any(fn.name == name and fn.owner is None and fn.scope is None
               for fn in f.functions):
            return True
        if any(r.var == name for r in f.routers) or name in f.drf_routers:
            return True
        if any(t.name == name for t in self.types[i]):
            return True
        if any(e.local == name for e in f.exports):
            return True  # an exported variable (a router, an object)
        return False

    def resolve_ref(self, i: int, ref: str) -> tuple[int, str] | None:
        """A dotted reference written in file `i` (`views.list`, `ctrl.list`,
        `UserView`) → the file and name it denotes."""
        if ref.startswith("require:"):
            t = self._js_target(self.files[i].path, ref[len("require:"):])
            return self.find_symbol(t, "default") if t is not None else None
        head, _, rest = ref.partition(".")
        if not rest:
            return self.local_symbol(i, head)
        b = self.binding(i, head)
        if b is not None and b["target"] is not None and b["kind"] in (
                "namespace", "module", "default", "require"):
            t = self.by_path.get(b["target"])
            if t is None:
                return None
            member = rest.split(".")[0]
            if b["kind"] in ("default", "require"):
                # CommonJS: `const ctrl = require('./c'); ctrl.list` reads module.exports.list.
                return self.find_symbol(t, member)
            if self.files[t].lang == "py" and "." in rest:
                return None
            return self.find_symbol(t, member)
        return None

    def function_index(self, i: int, name: str, owner: str | None = None) -> int | None:
        fns = self.files[i].flows.functions
        hits = [k for k, fn in enumerate(fns)
                if fn.name == name and fn.owner == owner and (owner is not None or fn.scope is None)]
        return hits[0] if len(hits) == 1 else None

    # --- routers and prefixes ------------------------------------------------------------

    def router_key(self, i: int, var: str) -> tuple[int, str] | None:
        """The (file, variable) that declares the router `var` used in file `i`."""
        f = self.files[i].flows
        if any(r.var == var for r in f.routers):
            return i, var
        hit = self.local_symbol(i, var)
        if hit is None:
            return None
        t, name = hit
        return (t, name) if any(r.var == name for r in self.files[t].flows.routers) else None

    def _router(self, key: tuple[int, str]):
        return next((r for r in self.files[key[0]].flows.routers if r.var == key[1]), None)

    def _mount_child(self, i: int, m: Mount) -> tuple[int, str] | None:
        if m.framework == "pass":
            hit = self.resolve_ref(i, m.target)
            if hit is None:
                return None
            t, name = hit
            fn = self.function_index(t, name)
            if fn is None or m.arg is None:
                return None
            params = self.files[t].flows.functions[fn].params
            if m.arg >= len(params):
                return None
            pname = params[m.arg].name
            return (t, pname) if any(r.var == pname for r in self.files[t].flows.routers) \
                else None
        if m.target.startswith("require:") or "." in m.target:
            hit = self.resolve_ref(i, m.target)
            if hit is None:
                return None
            return self.router_key(hit[0], hit[1])
        return self.router_key(i, m.target)

    def _build_mounts(self) -> None:
        self.parents: dict[tuple[int, str], list[tuple[tuple[int, str], Mount]]] = \
            defaultdict(list)
        for i, f in enumerate(self.files):
            for m in f.flows.mounts:
                parent = self.router_key(i, m.on)
                child = self._mount_child(i, m)
                if parent is None or child is None or parent == child:
                    continue
                self.parents[child].append((parent, m))

    def prefixes(self, key: tuple[int, str], depth: int = 0) -> list[tuple[str, str]]:
        """Every (full prefix, status) the router `key` is reachable under."""
        decl = self._router(key)
        own = decl.prefix if decl is not None else ""
        parents = self.parents.get(key, [])
        if depth > MAX_DEPTH:
            return [(own, "unknown")]
        if not parents:
            if decl is not None and decl.kind in APP_KINDS:
                return [("", "root")]
            return [(join_path(own) if own else "", "unknown")]
        out: list[tuple[str, str]] = []
        for parent, m in parents:
            for pp, st in self.prefixes(parent, depth + 1):
                if m.framework == "flask":
                    mp = m.prefix if m.prefix is not None else own
                    full = join_path(pp, mp or "")
                elif m.framework == "fastapi":
                    full = join_path(pp, m.prefix or "", own)
                else:  # express mounts, and routers passed into functions
                    full = join_path(pp, m.prefix or "") if (pp or m.prefix) else ""
                status = "resolved" if st in ("root", "resolved") else "unknown"
                if (full, status) not in out:
                    out.append((full, status))
        return out[:MAX_PREFIXES]

    # --- endpoints -----------------------------------------------------------------------

    def _handler(self, i: int, r: RouteDecl) -> dict:
        if r.handler_fn is not None:
            fn = self.files[i].flows.functions[r.handler_fn]
            return {"label": r.handler_label or fn.name, "path": self.files[i].path,
                    "fn": r.handler_fn, "line": fn.line}
        if r.handler_ref is not None:
            hit = self.resolve_ref(i, r.handler_ref.removesuffix(".as_view"))
            if hit is not None:
                fn = self.function_index(hit[0], hit[1])
                if fn is not None:
                    return {"label": r.handler_label, "path": self.files[hit[0]].path,
                            "fn": fn, "line": self.files[hit[0]].flows.functions[fn].line}
                return {"label": r.handler_label, "path": self.files[hit[0]].path,
                        "fn": None, "line": None}
        return {"label": r.handler_label, "path": None, "fn": None, "line": None}

    @staticmethod
    def _join_route(framework: str, prefix: str, path: str) -> str:
        """Flask and FastAPI concatenate a router prefix and a route literally, so a
        route of '/' under '/items' is '/items/'. Express treats both the same, so its
        paths are shown without the trailing slash."""
        out = join_path(prefix, path)
        if framework in ("flask", "fastapi") and path.endswith("/") and not out.endswith("/"):
            out += "/"
        return out

    def _class_methods(self, i: int, cls: str, depth: int = 0) -> tuple[set[str], set[str]]:
        """A view class's own HTTP-verb methods and its base-class simple names (repo
        bases are followed a few levels)."""
        own = {fn.name for fn in self.files[i].flows.functions if fn.owner == cls}
        decl = next((t for t in self.types[i] if t.name == cls), None)
        bases = {_simple(b) for b in (decl.extends if decl is not None else ())}
        if depth < 3 and decl is not None:
            for b in decl.extends:
                hit = self.resolve_ref(i, b)
                if hit is not None:
                    o2, b2 = self._class_methods(hit[0], hit[1], depth + 1)
                    own |= o2
                    bases |= b2
        return own, bases

    def _view_class_methods(self, i: int, cls_ref: str) -> tuple[list[str], dict]:
        hit = self.resolve_ref(i, cls_ref)
        if hit is None:
            return ["ANY"], {"label": f"{cls_ref}.as_view()", "path": None, "fn": None,
                             "line": None}
        t, cls = hit
        own, bases = self._class_methods(t, cls)
        methods = [m.upper() for m in HTTP_METHOD_NAMES if m in own]
        for b in bases:
            for m in VIEW_BASES.get(b, ()):
                if m not in methods:
                    methods.append(m)
        decl = next((ty for ty in self.types[t] if ty.name == cls), None)
        return methods or ["ANY"], {"label": f"{cls}.as_view()", "path": self.files[t].path,
                                    "fn": None, "line": decl.line if decl is not None else None}

    def endpoints(self) -> list[list[dict]]:
        self._build_mounts()
        out: list[list[dict]] = [[] for _ in self.files]
        nest_prefix = next((f.flows.global_prefix for f in self.files
                            if f.flows.global_prefix), None)
        for i, f in enumerate(self.files):
            for r in f.flows.routes:
                handler = self._handler(i, r)
                if r.framework in ("spring", "nestjs"):
                    path, status = r.path, "root"
                    if r.framework == "nestjs" and nest_prefix:
                        path, status = join_path(nest_prefix, r.path), "resolved"
                    variants = [(path, status)]
                    framework = r.framework
                else:
                    key = self.router_key(i, r.router) if r.router else None
                    decl = self._router(key) if key is not None else None
                    if decl is None:
                        continue  # not provably declared on an app or router
                    framework = decl.framework
                    variants = [(self._join_route(framework, pp, r.path), st)
                                for pp, st in self.prefixes(key)]
                methods = r.methods
                if methods == ["CLASS"] and r.handler_ref:
                    methods, handler = self._view_class_methods(
                        i, r.handler_ref.removesuffix(".as_view"))
                for path, status in variants:
                    for m in methods:
                        out[i].append({"framework": framework, "method": m, "path": path,
                                       "prefix": status, "line": r.line, "handler": handler})
        self._django(out)
        return out

    # --- Django --------------------------------------------------------------------------

    def _module_of(self, i: int) -> str | None:
        p = self.files[i].path
        if not p.endswith(".py"):
            return None
        parts = p[: -len(".py")].split("/")
        if parts[-1] == "__init__":
            parts = parts[:-1]
        return ".".join(parts)

    def _django(self, out: list[list[dict]]) -> None:
        roots = {f.flows.root_urlconf for f in self.files if f.flows.root_urlconf}
        url_files = [i for i, f in enumerate(self.files)
                     if f.lang == "py" and (f.flows.urlpatterns or f.flows.router_urls_appended)]
        included: dict[int, list[tuple[int, UrlPattern]]] = defaultdict(list)
        for i in url_files:
            for p in self._flatten(self.files[i].flows.urlpatterns):
                if p.include_module:
                    t = self.py_file(p.include_module)
                    if t is not None:
                        included[t].append((i, p))
        memo: dict[int, list[tuple[str, str]]] = {}

        def prefixes(i: int, depth: int = 0) -> list[tuple[str, str]]:
            if i in memo:
                return memo[i]
            if any(self.py_file(r) == i for r in roots) and not included.get(i):
                res = [("", "root")]
            elif not included.get(i) or depth > MAX_DEPTH:
                res = [("", "unknown")]
            else:
                res = []
                for parent, p in included[i]:
                    for pp, st in prefixes(parent, depth + 1):
                        full = join_path(pp, self._route(p))
                        status = "resolved" if st in ("root", "resolved") else "unknown"
                        if (full, status) not in res:
                            res.append((full, status))
                res = res[:MAX_PREFIXES]
            memo[i] = res
            return res

        for i in url_files:
            for base, status in prefixes(i):
                self._patterns(i, self.files[i].flows.urlpatterns, base, status, out)
                for router in self.files[i].flows.router_urls_appended:
                    self._drf_routes(i, router, base, status, out)

    @staticmethod
    def _flatten(patterns: list[UrlPattern]) -> list[UrlPattern]:
        out = []
        for p in patterns:
            out.append(p)
            if p.include_list:
                out.extend(Linker._flatten(p.include_list))
        return out

    @staticmethod
    def _route(p: UrlPattern) -> str:
        r = p.route
        if p.regex:
            r = r.removeprefix("^").removesuffix("$")
        return r

    def _patterns(self, i: int, patterns: list[UrlPattern], base: str, status: str,
                  out: list[list[dict]]) -> None:
        for p in patterns:
            path = join_path(base, self._route(p))
            if p.include_list is not None:
                self._patterns(i, p.include_list, path, status, out)
            elif p.include_router is not None:
                self._drf_routes(i, p.include_router, path, status, out)
            elif p.view_class is not None:
                methods, handler = self._view_class_methods(i, p.view_class)
                for m in methods:
                    out[i].append({"framework": "django", "method": m, "path": path,
                                   "prefix": status, "line": p.line, "handler": handler,
                                   "regex": p.regex})
            elif p.view is not None and not p.external_urls:
                handler = self._handler(i, RouteDecl("django", [], "", p.line,
                                                     handler_ref=p.view, handler_label=p.view))
                out[i].append({"framework": "django", "method": "ANY", "path": path,
                               "prefix": status, "line": p.line, "handler": handler,
                               "regex": p.regex})

    def _drf_routes(self, i: int, router: str, base: str, status: str,
                    out: list[list[dict]]) -> None:
        # The registrations live where the router variable is declared.
        hit = self.local_symbol(i, router)
        if hit is None:
            return
        t, var = hit
        for reg in self.files[t].flows.drf:
            if reg.router != var:
                continue
            target = self.resolve_ref(t, reg.viewset)
            slash = "" if var in self.files[t].flows.drf_no_slash else "/"
            prefix = join_path(base, reg.prefix).rstrip("/") + slash
            if target is None:
                out[t].append({"framework": "django", "method": "ANY", "path": prefix,
                               "prefix": status, "line": reg.line,
                               "handler": {"label": reg.viewset, "path": None, "fn": None,
                                           "line": None}})
                continue
            vf, cls = target
            own, bases = self._class_methods(vf, cls)
            actions = [a for a in VIEWSET_ACTIONS if a in own]
            for b in bases:
                actions += [a for a in VIEWSET_BASES.get(b, ()) if a not in actions]
            routes = []
            for a in VIEWSET_ACTIONS:
                if a in actions:
                    method, detail = VIEWSET_ACTIONS[a]
                    routes.append((method, prefix + ("/{pk}" + slash if detail and not slash
                                                     else "{pk}/" if detail else ""), a))
            for k, fn in enumerate(self.files[vf].flows.functions):
                if fn.owner == cls and fn.action:
                    seg = fn.action.get("url_path") or fn.name
                    base_path = prefix.rstrip("/") + ("/{pk}" if fn.action["detail"] else "")
                    for method in fn.action["methods"]:
                        routes.append((method, f"{base_path}/{seg}{slash}", fn.name))
            if not routes:
                routes = [("ANY", prefix, None)]
            for method, path, action in routes:
                fn_idx = self.function_index(vf, action, cls) if action else None
                out[t].append({"framework": "django", "method": method, "path": path,
                               "prefix": status, "line": reg.line,
                               "handler": {"label": f"{cls}.{action}" if action else cls,
                                           "path": self.files[vf].path, "fn": fn_idx,
                                           "line": self.files[vf].flows.functions[fn_idx].line
                                           if fn_idx is not None else None}})


def link_flows(files: Sequence[FlowFile], types_by_file: Sequence[list]) -> list[dict]:
    """Per file, what's stored in parsed_flows (empty dict when the file has nothing)."""
    linker = Linker(files, types_by_file)
    endpoints = linker.endpoints()
    calls = CallResolver(linker)
    queries = QueryLinker(linker, calls)
    out = []
    for i, f in enumerate(files):
        fl = f.flows
        row = {
            "functions": [_function(calls, queries, i, fn) for fn in fl.functions],
            "members": [asdict(m) for m in fl.members],
            "bindings": linker.bindings[i],
            "exports": [_export(linker, i, e) for e in fl.exports],
            "endpoints": endpoints[i],
            "package": fl.package,
        }
        has = any(row[k] for k in ("functions", "members", "bindings", "exports", "endpoints"))
        out.append(row if has else {})
    return out


def _function(calls: "CallResolver", queries: QueryLinker, i: int, fn) -> dict:
    d = asdict(fn)
    d.pop("locals")  # only needed to resolve calls, here
    d["calls"] = calls.resolve_function_calls(i, fn)
    calls.annotate_throws(i, d["body"])
    queries.apply(i, fn, d)
    if d.get("query") is None:
        d.pop("query", None)
    return d


def _export(linker: Linker, i: int, e) -> dict:
    d = {"name": e.name, "local": e.local}
    if e.spec is not None:
        t = linker._js_target(linker.files[i].path, e.spec)
        d["reexport"] = {"target": linker.files[t].path if t is not None else None,
                         "name": e.from_name}
    return d

