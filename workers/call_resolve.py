"""Resolves every recorded call to the function it reaches, for the APIs view's call
flows. Strict, like flow_link.py: a call resolves only through the calling file's own
definitions, its import bindings and the target file's exports, or through a declared
type. It is never matched by name elsewhere in the repo.

Each call ends up with exactly one of:
- `target`: {path, fn}, one function;
- `fanout`: [{path, fn}, …], the in-repo implementations of an interface or abstract
  method (up to MAX_FANOUT);
- `implementations`: {path, type, count}, more implementations than that;
- `untraced`: why it isn't followed:
    library    the name or type comes from outside the repo
    global     no binding and no definition (a builtin like print or console.log)
    untyped    a receiver whose type isn't declared (a plain JS parameter, `req`)
    ambiguous  more than one candidate (an `export *` collision, two packages)
    not_found  the module or type resolved but has no such member
    dynamic    a computed callee
A constructor call to a class without a constructor is marked `noConstructor`: there's
nothing to follow, but it keeps its place (the statement tree refers to calls by index).
"""

from collections import defaultdict
from dataclasses import asdict

from calls import DYNAMIC

MAX_FANOUT = 3
MAX_SUPER_DEPTH = 5
CONCRETE = ("class", "record", "enum")

Key = tuple[int, str]  # (file index, class name)


class Outcome:
    """A type or symbol lookup that failed, with the reason to report."""

    def __init__(self, reason: str):
        self.reason = reason


class CallResolver:
    def __init__(self, linker):
        self.l = linker
        self.files = linker.files
        self.types = linker.types
        self.decl: dict[Key, object] = {}
        for i, ts in enumerate(self.types):
            for t in ts:
                self.decl.setdefault((i, t.name), t)
        self.members: dict[Key, dict[str, str]] = defaultdict(dict)
        for i, f in enumerate(self.files):
            for m in f.flows.members:
                self.members[(i, m.owner)].setdefault(m.name, m.type)
        self.by_package: dict[str, list[int]] = defaultdict(list)
        for i, f in enumerate(self.files):
            if f.lang == "java":
                self.by_package[f.flows.package or ""].append(i)
        self._type_memo: dict[tuple[int, str], Key | Outcome] = {}
        self.implementers: dict[Key, list[Key]] = defaultdict(list)
        for (i, name), d in self.decl.items():
            for sup in tuple(d.extends) + tuple(d.implements):
                r = self.resolve_type(i, sup)
                if not isinstance(r, Outcome) and r != (i, name):
                    self.implementers[r].append((i, name))

    # --- types -----------------------------------------------------------------------

    def is_class(self, key: Key) -> bool:
        return key in self.decl

    def resolve_type(self, i: int, name: str) -> Key | Outcome:
        memo = (i, name)
        if memo not in self._type_memo:
            self._type_memo[memo] = self._resolve_type(i, name)
        return self._type_memo[memo]

    def _resolve_type(self, i: int, name: str) -> Key | Outcome:
        f = self.files[i]
        name = name.split("<", 1)[0].strip()
        if not name:
            return Outcome("untyped")
        if f.lang == "java":
            return self._java_type(i, name)
        if "." in name:
            hit = self.l.resolve_ref(i, name)
            if hit is not None:
                # A symbol that isn't a class (a type alias, a variable): can't see through it.
                return hit if self.is_class(hit) else Outcome("untyped")
            b = self.l.binding(i, name.split(".")[0])
            return Outcome("library" if b is not None and b["target"] is None else "not_found")
        if (i, name) in self.decl:
            return (i, name)
        b = self.l.binding(i, name)
        if b is None:
            return Outcome("global")
        if b["target"] is None:
            return Outcome("library")
        hit = self.l.local_symbol(i, name)
        if hit is None:
            return Outcome("ambiguous" if self._star_ambiguous(i, name) else "not_found")
        return hit if self.is_class(hit) else Outcome("untyped")

    def _star_ambiguous(self, i: int, name: str) -> bool:
        b = self.l.binding(i, name)
        if b is None or b["target"] is None:
            return False
        t = self.l.by_path.get(b["target"])
        if t is None:
            return False
        want = b["name"] or name
        hits = 0
        for e in self.files[t].flows.exports:
            if e.name == "*" and e.spec is not None:
                src = self.l._js_target(self.files[t].path, e.spec)
                if src is not None and self.l.find_symbol(src, want) is not None:
                    hits += 1
        return hits > 1

    def _java_type(self, i: int, name: str) -> Key | Outcome:
        if "." in name:  # a.b.C, or Outer.Inner
            hit = self.l.java.classes.get(name)
            if hit is not None:
                return (hit, name.rsplit(".", 1)[1])
            head, _, last = name.rpartition(".")
            outer = self._java_type(i, head)
            if not isinstance(outer, Outcome) and (outer[0], last) in self.decl:
                return (outer[0], last)
            return Outcome("library")
        if (i, name) in self.decl:
            return (i, name)
        b = self.l.binding(i, name)
        if b is not None and b["kind"] == "named":
            t = self.l.by_path.get(b["target"]) if b["target"] else None
            if t is None:
                return Outcome("library")
            return (t, name) if (t, name) in self.decl else Outcome("not_found")
        pkg = self.files[i].flows.package or ""
        same = [t for t in self.by_package.get(pkg, []) if (t, name) in self.decl]
        if len(same) == 1:
            return (same[0], name)
        if len(same) > 1:
            return Outcome("ambiguous")
        cands = []
        for wb in self.l.bindings[i]:
            if wb["kind"] == "package" and wb["target"]:
                cands += [t for t in self.by_package.get(wb["target"], []) if (t, name) in self.decl]
        if len(cands) == 1:
            return (cands[0], name)
        if len(cands) > 1:
            return Outcome("ambiguous")
        return Outcome("library")  # java.lang, or a wildcard import from a library

    def supertypes(self, key: Key) -> list[Key]:
        d = self.decl.get(key)
        out = []
        for sup in (tuple(d.extends) + tuple(d.implements)) if d is not None else ():
            r = self.resolve_type(key[0], sup)
            if not isinstance(r, Outcome):
                out.append(r)
        return out

    def type_chain(self, i: int, name: str) -> tuple[list[str], bool]:
        """A thrown type and its superclasses, resolved strictly in the repo: (names,
        complete). Incomplete when the chain leaves the repo (a library base class) or
        the type itself isn't found; the last name is then where it left."""
        r = self.resolve_type(i, name)
        if isinstance(r, Outcome):
            return [name.rsplit(".", 1)[-1]], False
        chain = [r[1]]
        key = r
        for _ in range(10):
            d = self.decl.get(key)
            bases = tuple(d.extends) if d is not None else ()
            if not bases:
                return chain, True
            nxt = self.resolve_type(key[0], bases[0])
            if isinstance(nxt, Outcome):
                chain.append(bases[0].rsplit(".", 1)[-1].split("<", 1)[0])
                return chain, False
            if nxt[1] in chain:
                return chain, True
            chain.append(nxt[1])
            key = nxt
        return chain, False

    def annotate_throws(self, i: int, steps: list[dict]) -> None:
        """Adds `typeChain` / `chainComplete` to every throw step with an evident type."""
        for st in steps:
            if st.get("kind") == "throw" and st.get("type"):
                chain, complete = self.type_chain(i, st["type"])
                st["typeChain"] = chain
                st["chainComplete"] = complete
            for key in ("then", "else", "body", "orelse", "finally", "init"):
                if isinstance(st.get(key), list):
                    self.annotate_throws(i, st[key])
            for c in st.get("cases") or []:
                self.annotate_throws(i, c["body"])
            for c in st.get("catches") or []:
                self.annotate_throws(i, c["body"])

    # --- methods ---------------------------------------------------------------------

    def method_on(self, key: Key, name: str, argc: int | None,
                  depth: int = 0) -> tuple[int, int] | Outcome:
        t, cls = key
        fns = self.files[t].flows.functions
        own = [k for k, fn in enumerate(fns) if fn.owner == cls and fn.name == name]
        if len(own) > 1 and argc is not None:
            fit = [k for k in own if self._arity(fns[k], t) == argc]
            own = fit or own
        if len(own) == 1:
            return (t, own[0])
        if len(own) > 1:
            return Outcome("ambiguous")  # overloads the argument count doesn't separate
        if depth >= MAX_SUPER_DEPTH:
            return Outcome("not_found")
        library_super = False
        for sup in self.supertypes(key):
            r = self.method_on(sup, name, argc, depth + 1)
            if not isinstance(r, Outcome) or r.reason == "ambiguous":
                return r
            library_super = library_super or r.reason == "library"
        # Not in the repo's part of the hierarchy, but a supertype comes from a library
        # (JpaRepository.save, a framework base class): the method may well live there.
        if library_super or self._has_library_super(key):
            return Outcome("library")
        return Outcome("not_found")

    def _has_library_super(self, key: Key) -> bool:
        d = self.decl.get(key)
        for sup in (tuple(d.extends) + tuple(d.implements)) if d is not None else ():
            r = self.resolve_type(key[0], sup)
            if isinstance(r, Outcome) and r.reason in ("library", "global"):
                return True
        return False

    def _arity(self, fn, t: int) -> int:
        params = fn.params
        if self.files[t].lang == "py" and params and params[0].name in ("self", "cls"):
            params = params[1:]
        return len(params)

    def concrete_implementers(self, key: Key) -> list[Key]:
        seen: list[Key] = []
        frontier = [key]
        for _ in range(3):
            nxt = []
            for k in frontier:
                for impl in self.implementers.get(k, []):
                    if impl not in seen and impl != key:
                        seen.append(impl)
                        nxt.append(impl)
            frontier = nxt
        return [k for k in seen if getattr(self.decl.get(k), "kind", "") in CONCRETE]

    def dispatch(self, hit: tuple[int, int], name: str, argc: int | None) -> dict:
        """A resolved method; an interface or abstract one fans out to its in-repo
        implementations, or stays itself when there are none (e.g. Spring Data)."""
        t, k = hit
        fn = self.files[t].flows.functions[k]
        owner_kind = getattr(self.decl.get((t, fn.owner)), "kind", None) if fn.owner else None
        if not (fn.abstract or owner_kind in ("interface", "abstract")):
            return {"target": self._ref(t, k)}
        targets: list[tuple[int, int]] = []
        for impl in self.concrete_implementers((t, fn.owner)):
            r = self.method_on(impl, name, argc)
            if not isinstance(r, Outcome) and r != hit and \
                    not self.files[r[0]].flows.functions[r[1]].abstract and r not in targets:
                targets.append(r)
        if not targets:
            return {"target": self._ref(t, k)}
        if len(targets) > MAX_FANOUT:
            return {"implementations": {"path": self.files[t].path, "type": fn.owner,
                                        "count": len(targets)}}
        return {"fanout": [self._ref(a, b) for a, b in targets]}

    def constructor(self, key: Key) -> tuple[int, int] | None:
        t, cls = key
        names = {"py": "__init__", "java": cls}.get(self.files[t].lang, "constructor")
        for k, fn in enumerate(self.files[t].flows.functions):
            if fn.owner == cls and fn.name == names:
                return (t, k)
        return None

    def _ref(self, t: int, k: int) -> dict:
        return {"path": self.files[t].path, "fn": k}

    # --- calls -----------------------------------------------------------------------

    def resolve_function_calls(self, i: int, fn) -> list[dict]:
        out = []
        for c in fn.calls:
            res = self._resolve(i, fn, c)
            if res is None:
                # A class without its own constructor: nothing to follow, but it stays in
                # place, because the statement tree refers to calls by index.
                res = {"noConstructor": True}
            out.append({**asdict(c), **res})
        return out

    def _resolve(self, i: int, fn, c) -> dict | None:
        if c.receiver == DYNAMIC or not c.name:
            return {"untraced": "dynamic"}
        lang = self.files[i].lang
        if c.new:
            ref = f"{c.receiver}.{c.name}" if c.receiver else c.name
            r = self.resolve_type(i, ref)
            if isinstance(r, Outcome):
                return {"untraced": r.reason}
            ctor = self.constructor(r)
            return {"target": self._ref(*ctor)} if ctor is not None else None
        if c.receiver in ("this", "self") or (c.receiver is None and lang == "java"
                                               and fn.owner is not None):
            return self._on_own_class(i, fn, c)
        if c.receiver == "super":
            if fn.owner is None:
                return {"untraced": "untyped"}
            for sup in self.supertypes((i, fn.owner)):
                r = self.method_on(sup, c.name, c.args)
                if not isinstance(r, Outcome):
                    return self.dispatch(r, c.name, c.args)
            return {"untraced": "library" if self._has_library_super((i, fn.owner))
                    else "not_found"}
        if c.receiver is None:
            return self._bare(i, fn, c)
        return self._chain(i, fn, c)

    def _on_own_class(self, i: int, fn, c) -> dict:
        if fn.owner is None:
            return {"untraced": "untyped"}
        r = self.method_on((i, fn.owner), c.name, c.args)
        if not isinstance(r, Outcome):
            return self.dispatch(r, c.name, c.args)
        if c.receiver is None:  # Java: maybe a static import
            b = self.l.binding(i, c.name)
            if b is not None and b["kind"] == "static":
                t = self.l.by_path.get(b["target"]) if b["target"] else None
                if t is None:
                    return {"untraced": "library"}
                cls = b["name"].split(".")[0]
                r2 = self.method_on((t, cls), c.name, c.args)
                return self.dispatch(r2, c.name, c.args) if not isinstance(r2, Outcome) \
                    else {"untraced": r2.reason}
        return {"untraced": r.reason}

    def _bare(self, i: int, fn, c) -> dict | None:
        param = next((p for p in fn.params if p.name == c.name), None)
        if param is not None:  # calling a callback passed in (`next()`)
            if param.type:
                r = self.resolve_type(i, param.type)
                if isinstance(r, Outcome) and r.reason in ("library", "global"):
                    return {"untraced": "library"}
            return {"untraced": "untyped"}
        fns = self.files[i].flows.functions
        for scope in (fn.name, fn.scope, None):
            hits = [k for k, g in enumerate(fns)
                    if g.name == c.name and g.owner is None and g.scope == scope
                    and not g.synthetic]
            if len(hits) == 1:
                return {"target": self._ref(i, hits[0])}
            if scope is None and len(hits) > 1:
                return {"untraced": "ambiguous"}
        if (i, c.name) in self.decl:  # Python / JS class in this file: its constructor
            ctor = self.constructor((i, c.name))
            return {"target": self._ref(*ctor)} if ctor is not None else None
        b = self.l.binding(i, c.name)
        if b is None:
            return {"untraced": "global"}
        if b["target"] is None:
            return {"untraced": "library"}
        hit = self.l.local_symbol(i, c.name)
        if hit is None:
            return {"untraced": "ambiguous" if self._star_ambiguous(i, c.name) else "not_found"}
        return self._symbol_call(hit, c)

    def _symbol_call(self, hit: tuple[int, str], c) -> dict | None:
        """A call to a named symbol: a top-level function, or a class (its constructor)."""
        t, name = hit
        if self.is_class(hit):
            ctor = self.constructor(hit)
            return {"target": self._ref(*ctor)} if ctor is not None else None
        k = self.l.function_index(t, name)
        if k is None:
            # Defined, but as a value (`const User = createParamDecorator(…)`), not a function.
            return {"untraced": "untyped"}
        return {"target": self._ref(t, k)}

    def _typed(self, i: int, fn, head: str) -> str | Outcome | None:
        """The declared type of a parameter, local or (Java, implicitly) field."""
        for p in fn.params:
            if p.name == head:
                return p.type if p.type else Outcome("untyped")
        for loc in fn.locals:
            if loc.name == head:
                if loc.ctor:  # Python `x = T(…)`: only if T is a class
                    r = self.resolve_type(i, loc.type)
                    return loc.type if not isinstance(r, Outcome) else Outcome("untyped")
                return loc.type
        if self.files[i].lang == "java" and fn.owner is not None:
            t = self._member_type((i, fn.owner), head)
            if t is not None:
                return t
        return None

    def _member_type(self, key: Key, name: str, depth: int = 0) -> str | None:
        t = self.members.get(key, {}).get(name)
        if t is not None or depth >= MAX_SUPER_DEPTH:
            return t
        for sup in self.supertypes(key):
            t = self._member_type(sup, name, depth + 1)
            if t is not None:
                return t
        return None

    def _chain(self, i: int, fn, c) -> dict | None:
        parts = c.receiver.split(".")
        head, rest = parts[0], parts[1:]
        start: Key | Outcome | None = None
        if head in ("this", "self"):
            if fn.owner is None or not rest:
                return {"untraced": "untyped"}
            t = self._member_type((i, fn.owner), rest[0])
            if t is None:
                return {"untraced": "untyped"}
            start = self.resolve_type(i, t)
            rest = rest[1:]
        else:
            typed = self._typed(i, fn, head)
            if isinstance(typed, Outcome):
                return {"untraced": typed.reason}
            if typed is not None:
                start = self.resolve_type(i, typed)
            else:
                return self._qualified(i, c, head, rest)
        if isinstance(start, Outcome):
            return {"untraced": "library" if start.reason == "global" else start.reason}
        return self._walk_members(start, rest, c)

    def _walk_members(self, key: Key, rest: list[str], c) -> dict:
        """`a.b.c.m()` with `a` of type A: follow declared member types to `m`'s owner."""
        for name in rest:
            t = self._member_type(key, name)
            if t is None:
                return {"untraced": "untyped"}
            nxt = self.resolve_type(key[0], t)
            if isinstance(nxt, Outcome):
                return {"untraced": "library" if nxt.reason == "global" else nxt.reason}
            key = nxt
        r = self.method_on(key, c.name, c.args)
        if isinstance(r, Outcome):
            return {"untraced": r.reason}
        return self.dispatch(r, c.name, c.args)

    def _qualified(self, i: int, c, head: str, rest: list[str]) -> dict | None:
        """`ns.f()`, `module.f()`, `Cls.f()`, `Cls.Inner.f()` and friends, where the head
        is an import or a class rather than a typed variable."""
        f = self.files[i]
        if (i, head) in self.decl:  # a class in this file
            return self._static_chain((i, head), rest, c)
        b = self.l.binding(i, head)
        if b is None:
            if f.lang == "java":
                r = self.resolve_type(i, head)
                if not isinstance(r, Outcome):
                    return self._static_chain(r, rest, c)
                return {"untraced": r.reason if r.reason != "global" else "global"}
            return {"untraced": "global"}
        if b["target"] is None:
            return {"untraced": "library"}
        if f.lang == "java":
            r = self.resolve_type(i, head)
            return self._static_chain(r, rest, c) if not isinstance(r, Outcome) \
                else {"untraced": r.reason}
        if b["kind"] in ("namespace", "module", "require", "default"):
            t = self.l.by_path.get(b["target"])
            if t is None:
                return {"untraced": "not_found"}
            if b["kind"] == "module" and rest:  # a.b.c.f(): submodules, then the function
                return self._py_submodule(t, rest, c)
            if b["kind"] == "default":
                # `import x from './m'; x.f()`: a property of m's default export.
                d = self.l.find_symbol(t, "default")
                if d is not None and self.is_class(d):
                    return self._static_chain(d, rest, c)
                return {"untraced": "untyped"}
            first = rest[0] if rest else c.name
            hit = self.l.find_symbol(t, first)
            if hit is None and b["kind"] == "require":
                # CommonJS `module.exports = obj`: a property of that object.
                d = self.l.find_symbol(t, "default")
                if d is not None and self.is_class(d):
                    return self._static_chain(d, rest, c)
                if any(e.name == "default" for e in self.files[t].flows.exports):
                    return {"untraced": "untyped"}
            if hit is None:
                return {"untraced": "ambiguous" if self._export_star_count(t, first) > 1
                        else "not_found"}
            if rest:
                if self.is_class(hit):
                    return self._static_chain(hit, rest[1:], c)
                return {"untraced": "untyped"}  # an exported object's property
            return self._symbol_call(hit, c)
        hit = self.l.local_symbol(i, head)
        if hit is None:
            return {"untraced": "ambiguous" if self._star_ambiguous(i, head) else "not_found"}
        if self.is_class(hit):
            return self._static_chain(hit, rest, c)
        return {"untraced": "untyped"}  # an imported object, not a class or module

    def _export_star_count(self, t: int, name: str) -> int:
        n = 0
        for e in self.files[t].flows.exports:
            if e.name == "*" and e.spec is not None:
                src = self.l._js_target(self.files[t].path, e.spec)
                if src is not None and self.l.find_symbol(src, name) is not None:
                    n += 1
        return n

    def _py_submodule(self, t: int, rest: list[str], c) -> dict | None:
        mod = self.l._module_of(t)
        for k, seg in enumerate(rest):
            sub = self.l.py_file(f"{mod}.{seg}") if mod else None
            if sub is None:
                hit = self.l.find_symbol(t, seg)
                if hit is not None and self.is_class(hit):
                    return self._static_chain(hit, rest[k + 1:], c)
                return {"untraced": "not_found" if hit is None else "untyped"}
            t, mod = sub, f"{mod}.{seg}"
        hit = self.l.find_symbol(t, c.name)
        return self._symbol_call(hit, c) if hit is not None else {"untraced": "not_found"}

    def _static_chain(self, key: Key, rest: list[str], c) -> dict | None:
        """`Cls.m()` (a static method, or a constructor via `Cls.Inner`), or a member walk
        when the chain continues through declared static fields."""
        for name in rest:
            inner = (key[0], name)
            if inner in self.decl:  # Outer.Inner
                key = inner
                continue
            t = self._member_type(key, name)
            if t is None:
                return {"untraced": "untyped"}
            nxt = self.resolve_type(key[0], t)
            if isinstance(nxt, Outcome):
                return {"untraced": "library" if nxt.reason == "global" else nxt.reason}
            key = nxt
        r = self.method_on(key, c.name, c.args)
        if isinstance(r, Outcome):
            return {"untraced": r.reason}
        return self.dispatch(r, c.name, c.args)
