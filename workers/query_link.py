"""Confirms or drops the query candidates queries.py found, once every file is parsed.

A candidate names the evidence it needs; each check here uses only the calling file's
own bindings, the repo's exports and declared types (as call_resolve.py does):
- `literal`: a plain SQL string in the supported subset (nothing else to check);
- `module`: a name imported from one of the library's modules;
- `driver` / `knex` / `prisma`: a name that is such an import, or a module-level
  instance a library built (`export default new PrismaClient()`), reached through
  bindings;
- `typeorm` / `jdbc` / `session`: a receiver whose declared type is the library's
  (directly, through a repo class that extends it, or a repo `Annotated[…]` alias);
- `model`: a name that resolves to a repo entity of the expected ORM (and language).
The first alternative whose checks all pass wins; a candidate with none is dropped.

Spring Data built-ins (`owners.save(o)`) are added here: the receiver's type is a repo
interface extending a Spring Data base, and the method comes from that base.
"""

from queries import SPRING_BUILTINS, SQLALCHEMY_SPECS, capped

TYPEORM_TYPES = ("Repository", "EntityManager", "DataSource", "Connection",
                 "MongoRepository", "TreeRepository")
MAX_HOPS = 3


def _matches(spec: str | None, specs) -> bool:
    return spec is not None and any(spec == s or spec.startswith(s + ".") or
                                    spec.startswith(s + "/") for s in specs)


class QueryLinker:
    def __init__(self, linker, calls):
        self.l = linker
        self.c = calls
        self.files = linker.files
        self.entities = [getattr(f, "entities", []) or [] for f in self.files]

    # --- names ---------------------------------------------------------------------

    def lib_spec(self, i: int, local: str) -> str | None:
        """The library module a local name is imported from (None: not a library import)."""
        for raw, b in zip(self.files[i].flows.bindings, self.l.bindings[i]):
            if raw.local == local and b["target"] is None:
                return raw.spec
        return None

    def from_library(self, i: int, name: str, specs) -> bool:
        """`name` in file `i` is a library import, or a module-level instance a library
        built (here, or wherever the binding leads)."""
        if _matches(self.lib_spec(i, name), specs):
            return True
        inst = self.files[i].flows.instances.get(name)
        if inst is not None:
            return _matches(inst["spec"], specs)
        hit = self.l.local_symbol(i, name)
        if hit is None:
            return False
        t, var = hit
        inst = self.files[t].flows.instances.get(var)
        return inst is not None and _matches(inst["spec"], specs)

    def type_from(self, i: int, t: str, specs, depth: int = 0) -> bool:
        """A declared type is the library's: imported from it, a repo class extending
        it, or a repo `X = Annotated[T, …]` alias of it."""
        if depth > MAX_HOPS or not t:
            return False
        if _matches(self.lib_spec(i, t.split(".")[0]), specs):
            return True
        r = self.c.resolve_type(i, t)
        if isinstance(r, tuple):
            d = self.c.decl.get(r)
            for sup in (tuple(d.extends) + tuple(d.implements)) if d is not None else ():
                if self.type_from(r[0], sup, specs, depth + 1):
                    return True
            return False
        hit = self.l.local_symbol(i, t)
        if hit is not None:
            alias = self.files[hit[0]].flows.aliases.get(hit[1])
            if alias:
                return self.type_from(hit[0], alias, specs, depth + 1)
        alias = self.files[i].flows.aliases.get(t)
        return bool(alias) and self.type_from(i, alias, specs, depth + 1)

    def receiver_from(self, i: int, fn, receiver: str, specs, types=None) -> bool:
        decl = self.c.receiver_decl(i, fn, receiver)
        if decl is None:
            return False
        t, _, at = decl
        if types is not None and t.split(".")[-1] not in types and \
                not isinstance(self.c.resolve_type(at, t), tuple):
            return False
        return self.type_from(at, t, specs)

    def entity(self, i: int, name: str | None, orms) -> dict | None:
        """A name in file `i` → the repo entity it denotes, of one of these ORMs."""
        if not name:
            return None
        r = self.c.resolve_type(i, name)
        if not isinstance(r, tuple):
            hit = self.l.resolve_ref(i, name)
            if hit is None:
                return None
            r = hit
        t, cls = r
        for e in self.entities[t]:
            if e.name == cls and e.orm in orms:
                return {"path": self.files[t].path, "name": e.name}
        return None

    def is_model(self, i: int, name: str, orms) -> bool:
        """`name` is an entity of one of these ORMs, or a repo class whose superclass
        chain reaches one (Django `class Article(TimestampedModel)`)."""
        if self.entity(i, name, orms) is not None:
            return True
        r = self.c.resolve_type(i, name)
        if not isinstance(r, tuple):
            return False
        stack, seen = list(self.c.supertypes(r)), 0
        while stack and seen < 8:
            t, cls = stack.pop(0)
            seen += 1
            if any(e.name == cls and e.orm in orms for e in self.entities[t]):
                return True
            stack += self.c.supertypes((t, cls))
        return False

    def table_entity(self, i: int, table: str | None) -> dict | None:
        """A raw SQL table → the one repo entity (same language) declaring that table."""
        if not table:
            return None
        lang = self.files[i].lang
        want = table.split(".")[-1].lower()
        hits = [(t, e) for t, es in enumerate(self.entities) for e in es
                if self.files[t].lang == lang and e.table.lower() == want]
        if len(hits) != 1:
            return None
        t, e = hits[0]
        return {"path": self.files[t].path, "name": e.name}

    # --- checks --------------------------------------------------------------------

    def check(self, i: int, fn, req: dict) -> bool:
        if req.get("literal"):
            return True
        if "module" in req:
            return _matches(self.lib_spec(i, req["module"]), req["specs"])
        if "driver" in req:
            return self.from_library(i, req["driver"], req["specs"])
        if "knex" in req:
            return self.from_library(i, req["knex"], ["knex"])
        if "prisma" in req:
            root = req["prisma"]
            if "." not in root and self.from_library(i, root, ["@prisma/client"]):
                return True
            return self.receiver_from(i, fn, root, ["@prisma/client"])
        if "typeorm" in req:
            return self.receiver_from(i, fn, req["typeorm"], ["typeorm"], TYPEORM_TYPES)
        if "jdbc" in req:
            return self.receiver_from(i, fn, req["jdbc"], ["org.springframework.jdbc"])
        if "session" in req:
            rec = req["session"]
            head, _, rest = rec.partition(".")
            if rest == "session" and self.from_library(i, head, ["flask_sqlalchemy"]):
                return True
            return self.receiver_from(i, fn, rec, SQLALCHEMY_SPECS)
        if "model" in req:
            return self.is_model(i, req["model"], req["orms"])
        return False

    def confirm(self, i: int, fn, alts: list[dict]) -> dict | None:
        for alt in alts:
            for checks in alt["evidence"]:
                if all(self.check(i, fn, req) for req in checks):
                    return self._final(i, fn, alt)
        return None

    def _final(self, i: int, fn, alt: dict) -> dict:
        q = dict(alt["query"])
        q.pop("targetIsEntity", None)
        ent = alt.get("entity")
        found = None
        if ent is not None:
            if "receiverArg" in ent:
                decl = self.c.receiver_decl(i, fn, ent["receiverArg"])
                if decl is not None and decl[1]:
                    found = self.entity(decl[2], decl[1], ent["orms"])
                    if q.get("target") is None:
                        q["target"] = decl[1]
            else:
                found = self.entity(i, ent.get("model") or ent.get("type"), ent["orms"])
        elif q["kind"] == "sql":
            found = self.table_entity(i, q.get("target"))
        if found is not None:
            q["entity"] = found
        return q

    # --- per function --------------------------------------------------------------

    def apply(self, i: int, fn, d: dict) -> None:
        """Turns `db` alternatives into `query` on the stored calls; adds Spring Data
        built-ins; resolves a repository method definition's entity."""
        for raw, call in zip(fn.calls, d["calls"]):
            alts = call.pop("db", None)
            q = self.confirm(i, fn, alts) if alts else None
            if q is None:
                q = self._spring_builtin(i, fn, raw, call)
            if q is not None:
                call["query"] = q
        if d.get("query") is not None:
            q = dict(d["query"])
            if q.pop("targetIsEntity", False) and q.get("target"):
                found = self.entity(i, q["target"], ["jpa"])
                if found is not None:
                    q["entity"] = found
            d["query"] = q

    def _spring_builtin(self, i: int, fn, raw, call: dict) -> dict | None:
        if raw.name not in SPRING_BUILTINS or not raw.receiver or "target" in call or \
                "fanout" in call or self.files[i].lang != "java":
            return None
        decl = self.c.receiver_decl(i, fn, raw.receiver)
        if decl is None:
            return None
        r = self.c.resolve_type(decl[2], decl[0])
        if not isinstance(r, tuple):
            return None
        repo, key, seen = None, r, 0
        stack = [r]
        while stack and seen < 8:
            key = stack.pop(0)
            seen += 1
            repo = self.files[key[0]].flows.repositories.get(key[1])
            if repo is not None:
                break
            stack += self.c.supertypes(key)
        if repo is None:
            return None
        q = {"kind": "orm", "orm": "jpa", "op": SPRING_BUILTINS[raw.name],
             "target": repo["entity"], **capped(f"{raw.receiver}.{raw.name}(…)"),
             "executes": "yes"}
        found = self.entity(key[0], repo["entity"], ["jpa"])
        if found is not None:
            q["entity"] = found
        return q
