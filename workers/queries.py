"""Detected DB queries for the APIs view: the SQL subset classifier, the Spring Data
derived-query grammar, and per-function query candidates found on call chains.

Everything here is syntax. A candidate names the evidence it needs (an import of a
known library, a repo entity, a declared receiver type, or a literal SQL string);
flow_link.py confirms it across files or drops it. Nothing is guessed from names.

Ownership: a chain like `repo.createQueryBuilder().where(…).getMany()` is ONE query,
carried by exactly one of its calls:
- the terminal call when the chain runs here (`getMany`, `.all()`, an awaited knex or
  Prisma chain, iteration);
- the call itself for a direct executor (`cursor.execute`, `repo.save`);
- for a builder stored in a local assigned once, each consumer that runs it in the same
  function (`session.exec(stmt)`, `qb.getMany()`);
- otherwise the builder's first call, with executes 'unknown' (returned, passed on).

Ops: UPSERT only for real conflict-handling upserts (ON CONFLICT, MERGE, Prisma
`upsert`, TypeORM `orUpdate`); an ORM save that picks insert or update from the
entity's state (Spring Data / TypeORM `save`, Django `update_or_create`) is SAVE.
"""

import re

from tree_sitter import Node

TEXT_CAP = 500

# --- SQL: an explicit supported subset ------------------------------------------------

_COMMENTS = re.compile(r"^\s*(?:--[^\n]*\n|/\*.*?\*/|\s+)*", re.S)
_IDENT = r'[`"\[]?[\w$]+[`"\]]?(?:\.[`"\[]?[\w$]+[`"\]]?)?'
_FROM_ONE = re.compile(
    r"\bFROM\s+(" + _IDENT + r")(?:\s+(?:AS\s+)?(?!WHERE\b|GROUP\b|ORDER\b|LIMIT\b|HAVING\b"
    r"|OFFSET\b|FOR\b|WINDOW\b|FETCH\b|UNION\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|OUTER\b|FULL\b"
    r"|CROSS\b|NATURAL\b)[\w$]+)?\s*(?:$|WHERE\b|GROUP\b|ORDER\b|LIMIT\b|HAVING\b|OFFSET\b"
    r"|FOR\b|FETCH\b)", re.I | re.S)


def _bare(ident: str) -> str:
    return re.sub(r'[`"\[\]]', "", ident)


def classify_sql(sql: str) -> tuple[str, str | None]:
    """(op, target) for a SQL (or JPQL) string, within the supported subset only:
    anything else is ('UNKNOWN', None), never guessed from the first keyword."""
    s = _COMMENTS.sub("", sql, count=1).strip()
    body = s.rstrip().rstrip(";")
    if not body or ";" in body:  # several statements in one string
        return "UNKNOWN", None
    up = body.upper()
    word = up.split(None, 1)[0] if up.split() else ""
    if word == "SELECT":
        m = re.search(r"\bFROM\b", body, re.I)
        if m is None:
            return "UNKNOWN", None
        if re.search(r"\b(JOIN|UNION|INTERSECT|EXCEPT)\b", up) or "(SELECT" in up.replace(
                " ", "") or re.search(r"\bFROM\s*\(", up):
            return "SELECT", None
        one = _FROM_ONE.search(body)
        if one is None:
            return "SELECT", None  # several tables, or a shape the subset doesn't follow
        return "SELECT", _bare(one.group(1))
    if word in ("INSERT", "REPLACE"):
        m = re.match(r"(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+(" + _IDENT + ")", body, re.I)
        if m is None:
            return "UNKNOWN", None
        if word == "REPLACE" or re.search(r"\bON\s+(CONFLICT|DUPLICATE\s+KEY\s+UPDATE)\b", up):
            return "UPSERT", _bare(m.group(1))
        return "INSERT", _bare(m.group(1))
    if word == "MERGE":
        m = re.match(r"MERGE\s+INTO\s+(" + _IDENT + ")", body, re.I)
        return ("UPSERT", _bare(m.group(1))) if m else ("UNKNOWN", None)
    if word == "UPDATE":
        m = re.match(r"UPDATE\s+(" + _IDENT + r")(?:\s+(?:AS\s+)?(?!SET\b)[\w$]+)?\s+SET\b",
                     body, re.I)
        return ("UPDATE", _bare(m.group(1))) if m else ("UNKNOWN", None)
    if word == "DELETE":
        m = re.match(r"DELETE\s+FROM\s+(" + _IDENT + ")", body, re.I)
        return ("DELETE", _bare(m.group(1))) if m else ("UNKNOWN", None)
    if word in ("CREATE", "ALTER", "DROP", "TRUNCATE"):
        m = re.match(r"(?:CREATE|ALTER|DROP|TRUNCATE)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?("
                     + _IDENT + r")\s*(?:$|\()", body, re.I)
        if word == "TRUNCATE" and m is None:
            m = re.match(r"TRUNCATE\s+(" + _IDENT + r")\s*$", body, re.I)
        return "OTHER", _bare(m.group(1)) if m else None
    if word in ("CALL", "EXEC", "EXECUTE"):
        return "OTHER", None
    return "UNKNOWN", None  # WITH (CTEs), dialect-only syntax, anything else


def in_subset(sql: str) -> bool:
    """A literal string that is, by its shape, a SQL statement we classify."""
    return classify_sql(sql)[0] != "UNKNOWN"


def capped(text: str) -> dict:
    """{text, textLength, truncated}: one line, at most TEXT_CAP characters."""
    flat = " ".join(text.split())
    if len(flat) <= TEXT_CAP:
        return {"text": flat, "textLength": len(flat), "truncated": False}
    return {"text": flat[: TEXT_CAP - 1] + "…", "textLength": len(flat), "truncated": True}


def sql_query(sql: str, orm: str, literal: bool, entity_target: bool = False) -> dict:
    """A raw SQL (or JPQL, `entity_target`) query. Non-literal SQL is shown as {…}."""
    if not literal:
        return {"kind": "sql", "orm": orm, "op": "UNKNOWN", "target": None, **capped("{…}")}
    op, target = classify_sql(sql)
    return {"kind": "sql", "orm": orm, "op": op, "target": target, **capped(sql),
            **({"targetIsEntity": True} if entity_target and target else {})}


# --- Spring Data derived queries ------------------------------------------------------

_SUBJECT = re.compile(r"^(find|read|get|query|search|stream|count|exists|delete|remove)"
                      r"(\w*?)By(\w*)$")
# Keyword → rendering, longest first so `NotLike` wins over `Like`, `LessThanEqual`
# over `LessThan`. `{p}` is the property, `{v}` the operand.
_KEYWORDS: list[tuple[str, str]] = [
    ("IsNotNull", "{p} IS NOT NULL"), ("NotNull", "{p} IS NOT NULL"),
    ("IsNull", "{p} IS NULL"), ("Null", "{p} IS NULL"),
    ("NotLike", "{p} NOT LIKE {v}"), ("Like", "{p} LIKE {v}"),
    ("StartingWith", "{p} LIKE {v}%"), ("StartsWith", "{p} LIKE {v}%"),
    ("EndingWith", "{p} LIKE %{v}"), ("EndsWith", "{p} LIKE %{v}"),
    ("NotContaining", "{p} NOT LIKE %{v}%"), ("Containing", "{p} LIKE %{v}%"),
    ("Contains", "{p} LIKE %{v}%"),
    ("LessThanEqual", "{p} <= {v}"), ("LessThan", "{p} < {v}"),
    ("GreaterThanEqual", "{p} >= {v}"), ("GreaterThan", "{p} > {v}"),
    ("Before", "{p} < {v}"), ("After", "{p} > {v}"),
    ("Between", "{p} BETWEEN {v} AND {v}"),
    ("NotIn", "{p} NOT IN ({v})"), ("In", "{p} IN ({v})"),
    ("True", "{p} = true"), ("False", "{p} = false"),
    ("Not", "{p} <> {v}"), ("Equals", "{p} = {v}"), ("Is", "{p} = {v}"),
]
# Keywords Spring supports that this grammar doesn't render: the condition is unknown.
_UNSUPPORTED = ("Near", "Within", "Regex", "Matches", "Exists", "IsEmpty", "IsNotEmpty",
                "NotEmpty", "Empty")


def _prop(camel: str) -> str:
    return camel[:1].lower() + camel[1:]


def _predicate(part: str, ignore_all: bool) -> str | None:
    """`LastNameStartingWith` → `lastName LIKE ?%`; None when it can't be rendered."""
    ignore = ignore_all
    for suffix in ("IgnoringCase", "IgnoreCase"):
        if part.endswith(suffix):
            part, ignore = part[: -len(suffix)], True
    for kw in _UNSUPPORTED:
        if part.endswith(kw) and len(part) > len(kw):
            return None
    prop, form = part, "{p} = {v}"
    for kw, rendering in _KEYWORDS:
        if part.endswith(kw) and len(part) > len(kw):
            prop, form = part[: -len(kw)], rendering
            if prop.endswith("Is") and len(prop) > 2 and kw not in ("Is",):
                prop = prop[:-2]  # `IsLessThan` and the like
            break
    if not re.fullmatch(r"[A-Z][A-Za-z0-9]*", prop or ""):
        return None
    p = _prop(prop)
    if ignore:
        return form.replace("{p}", f"UPPER({p})").replace("{v}", "UPPER(?)")
    return form.replace("{p}", p).replace("{v}", "?")


def derived_query(method: str, entity: str | None, param_types: list[str | None]) -> dict | None:
    """The query a Spring Data repository method's name declares, or None when the name
    isn't a derived query (`findAll`, a custom method)."""
    m = _SUBJECT.match(method)
    if m is None:
        return None
    verb, middle, rest = m.groups()
    op = "DELETE" if verb in ("delete", "remove") else "SELECT"
    distinct = "Distinct" in middle
    limit = None
    lm = re.search(r"(?:Top|First)(\d*)", middle)
    if lm is not None:
        limit = int(lm.group(1) or 1)
    cond, _, order = rest.partition("OrderBy")
    ignore_all = cond.endswith("AllIgnoreCase") or cond.endswith("AllIgnoringCase")
    if ignore_all:
        cond = re.sub(r"AllIgnor(e|ing)Case$", "", cond)
    parts = re.split(r"(?<=[a-z0-9])(And|Or)(?=[A-Z])", cond) if cond else []
    preds: list[str] = []
    unknown = not cond
    for k, p in enumerate(parts):
        if k % 2 == 1:
            preds.append(p.upper())
            continue
        rendered = _predicate(p, ignore_all)
        if rendered is None:
            unknown = True
            break
        preds.append(rendered)
    where = "?" if unknown else " ".join(preds)
    orders = []
    for o in re.findall(r"([A-Z][A-Za-z0-9]*?)(Asc|Desc)(?=[A-Z]|$)", order):
        orders.append(f"{_prop(o[0])} {o[1].upper()}")
    if order and not orders:
        orders.append("?")
    suffix = ""
    if "Pageable" in param_types:
        suffix = " (paged)"
    elif "Sort" in param_types:
        suffix = " (sorted)"
    target = entity or "?"
    if op == "DELETE":
        head = f"DELETE FROM {target}"
    elif verb == "count":
        head = f"SELECT COUNT(*) FROM {target}"
    elif verb == "exists":
        head = f"SELECT EXISTS … FROM {target}"
    else:
        head = f"SELECT {'DISTINCT ' if distinct else ''}… FROM {target}"
    text = f"{head} WHERE {where}"
    if orders:
        text += " ORDER BY " + ", ".join(orders)
    if limit is not None:
        text += f" LIMIT {limit}"
    detail = where + (" ORDER BY " + ", ".join(orders) if orders else "") + suffix
    q = {"kind": "derived", "orm": "jpa", "op": op, "target": entity, **capped(text + suffix),
         "detail": detail, "targetIsEntity": entity is not None}
    if unknown:
        q["predicate"] = "unknown"
    return q


# --- call chains ----------------------------------------------------------------------

CALL = {"js": ("call_expression",), "py": ("call",), "java": ("method_invocation",)}
WRAPPERS = ("parenthesized_expression", "non_null_expression", "as_expression",
            "type_assertion", "satisfies_expression")


def _t(node: Node | None) -> str:
    return node.text.decode("utf-8", errors="replace") if node is not None and node.text else ""


def _flat(node: Node | None) -> str:
    return " ".join(_t(node).split())


def literal(lang: str, node: Node | None) -> tuple[str, bool] | None:
    """(value, plain) for a string literal; `plain` is False when it interpolates.
    None for anything else (a variable, a concatenation)."""
    if node is None:
        return None
    if lang == "js":
        if node.type == "string":
            return _t(node)[1:-1], True
        if node.type == "template_string":
            subs = [c for c in node.children if c.type == "template_substitution"]
            text = "".join(_t(c) if c.type != "template_substitution" else "{…}"
                           for c in node.children if c.type not in ("`",))
            return text, not subs
        return None
    if lang == "py":
        if node.type == "call":  # SQLAlchemy `text("…")`
            fn = node.child_by_field_name("function")
            args = node.child_by_field_name("arguments")
            if fn is not None and _t(fn) in ("text", "sqlalchemy.text", "sa.text") and \
                    args is not None and len(args.named_children) == 1:
                return literal(lang, args.named_children[0])
            return None
        if node.type == "concatenated_string":
            parts = [literal(lang, c) for c in node.named_children]
            if any(p is None for p in parts):
                return None
            return "".join(p[0] for p in parts), all(p[1] for p in parts)
        if node.type != "string":
            return None
        out, plain = [], True
        for c in node.named_children:
            if c.type == "string_content" or c.type == "escape_sequence":
                out.append(_t(c))
            elif c.type == "interpolation":
                out.append("{…}")
                plain = False
        return "".join(out), plain
    if node.type == "string_literal":
        parts = ("string_fragment", "escape_sequence", "multiline_string_fragment")
        return "".join(_t(c) for c in node.named_children if c.type in parts), True
    if node.type == "text_block":
        return _t(node).strip('"').strip(), True
    return None


class Link:
    """One call in a chain: its name, its index in the function's calls, its node."""

    def __init__(self, name: str, index: int, node: Node, args: list[Node], receiver: str | None):
        self.name = name
        self.index = index
        self.node = node
        self.args = args
        self.receiver = receiver  # as calls.py recorded it (None for a bare call)


def _unwrap(node: Node | None) -> Node | None:
    while node is not None and node.type in WRAPPERS and node.named_children:
        node = node.named_children[0]
    return node


def _callee(lang: str, node: Node) -> tuple[Node | None, str]:
    """(object node or None, method name) of a call."""
    if lang == "java":
        return node.child_by_field_name("object"), _t(node.child_by_field_name("name"))
    fn = node.child_by_field_name("function")
    if fn is None:
        return None, ""
    if lang == "js" and fn.type == "member_expression":
        return fn.child_by_field_name("object"), _t(fn.child_by_field_name("property"))
    if lang == "py" and fn.type == "attribute":
        return fn.child_by_field_name("object"), _t(fn.child_by_field_name("attribute"))
    return None, _t(fn)


def _args(node: Node) -> list[Node]:
    a = node.child_by_field_name("arguments")
    if a is None:
        return []
    if a.type == "template_string":  # a tagged template: prisma.$queryRaw`…`
        return [a]
    return [c for c in a.named_children if c.type not in ("comment",)]


def _parent_skip(node: Node) -> tuple[Node | None, Node]:
    """The parent, past wrappers; and the child of it on the path (for field checks)."""
    child, p = node, node.parent
    while p is not None and p.type in WRAPPERS:
        child, p = p, p.parent
    return p, child


def _is_link_object(lang: str, node: Node) -> bool:
    """Is this call the object of a further method call (so not a chain's top)?"""
    p, child = _parent_skip(node)
    if p is None:
        return False
    if lang == "java":
        return p.type == "method_invocation" and p.child_by_field_name("object") == child
    member = "member_expression" if lang == "js" else "attribute"
    if p.type != member or p.child_by_field_name("object") != child:
        return False
    g, gchild = _parent_skip(p)
    return g is not None and g.type in CALL[lang] and g.child_by_field_name("function") == gchild


def use_of(lang: str, top: Node) -> dict:
    """How a chain's value is used: then (.then/.catch), iterated, returned, stored
    (with the local's name), passed (to the call node), or statement/other; plus
    `awaited` when it's the operand of `await` (`const qb = await …` is stored too)."""
    p, child = _parent_skip(top)
    if p is not None and p.type in ("await_expression", "await"):
        return {**_use(lang, p), "awaited": True}
    return {**_use(lang, top), "awaited": False}


def _use(lang: str, top: Node) -> dict:
    p, child = _parent_skip(top)
    if p is None:
        return {"use": "other"}
    t = p.type
    if lang == "js":
        if t == "variable_declarator" and p.child_by_field_name("value") == child:
            name = p.child_by_field_name("name")
            return {"use": "stored", "name": _t(name)} if name is not None and \
                name.type == "identifier" else {"use": "other"}
        if t == "assignment_expression" and p.child_by_field_name("right") == child:
            left = p.child_by_field_name("left")
            return {"use": "stored", "name": _t(left)} if left is not None and \
                left.type == "identifier" else {"use": "other"}
        if t == "return_statement" or (t == "arrow_function" and
                                        p.child_by_field_name("body") == child):
            return {"use": "returned"}
        if t == "arguments":
            return {"use": "passed", "call": p.parent}
        if t == "for_in_statement" and p.child_by_field_name("right") == child:
            return {"use": "iterated"}
        if t == "expression_statement":
            return {"use": "statement"}
        return {"use": "other"}
    if lang == "py":
        if t == "assignment" and p.child_by_field_name("right") == child:
            left = p.child_by_field_name("left")
            return {"use": "stored", "name": _t(left)} if left is not None and \
                left.type == "identifier" else {"use": "other"}
        if t == "return_statement":
            return {"use": "returned"}
        if t == "argument_list":
            call = p.parent
            fn = call.child_by_field_name("function") if call is not None else None
            if fn is not None and _t(fn) in ("list", "len", "tuple", "set", "sorted", "bool"):
                return {"use": "iterated"}
            return {"use": "passed", "call": call}
        if t in ("for_statement", "for_in_clause") and p.child_by_field_name("right") == child:
            return {"use": "iterated"}
        if t == "expression_statement":
            return {"use": "statement"}
        return {"use": "other"}
    if t == "variable_declarator" and p.child_by_field_name("value") == child:
        return {"use": "stored", "name": _t(p.child_by_field_name("name"))}
    if t == "return_statement":
        return {"use": "returned"}
    if t == "argument_list":
        return {"use": "passed", "call": p.parent}
    if t == "enhanced_for_statement" and p.child_by_field_name("value") == child:
        return {"use": "iterated"}
    if t == "expression_statement":
        return {"use": "statement"}
    return {"use": "other"}


def chain_of(lang: str, top: Node, index_of) -> list[Link] | None:
    """The calls of a chain, root first. None if a link isn't a recorded call."""
    links: list[Link] = []
    cur: Node | None = top
    while cur is not None and cur.type in CALL[lang]:
        k = index_of(cur)
        if k is None:
            return None
        obj, name = _callee(lang, cur)
        links.insert(0, Link(name, k, cur, _args(cur), None))
        cur = _unwrap(obj)
    return links


# --- library tables -------------------------------------------------------------------

S, I, U, D, UP, SV = "SELECT", "INSERT", "UPDATE", "DELETE", "UPSERT", "SAVE"

PRISMA = {**{m: S for m in ("findMany", "findFirst", "findUnique", "findFirstOrThrow",
                            "findUniqueOrThrow", "count", "aggregate", "groupBy")},
          "create": I, "createMany": I, "createManyAndReturn": I, "update": U,
          "updateMany": U, "upsert": UP, "delete": D, "deleteMany": D}
PRISMA_RAW = ("$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe")
TYPEORM_REPO = {**{m: S for m in ("find", "findBy", "findOne", "findOneBy", "findOneOrFail",
                                  "findOneByOrFail", "findAndCount", "findAndCountBy", "count",
                                  "countBy", "exist", "exists", "existsBy", "sum", "average",
                                  "minimum", "maximum", "findByIds")},
                "save": SV, "insert": I, "update": U, "upsert": UP, "increment": U,
                "decrement": U, "delete": D, "remove": D, "softDelete": D, "softRemove": D,
                "clear": D}
QB_TERMINAL = ("getMany", "getOne", "getOneOrFail", "getRawMany", "getRawOne",
               "getRawAndEntities", "getCount", "getManyAndCount", "getExists", "execute",
               "stream")
DJANGO_LAZY = ("filter", "exclude", "all", "order_by", "select_related", "prefetch_related",
               "values", "values_list", "annotate", "distinct", "only", "defer", "none",
               "using", "reverse", "extra", "alias", "select_for_update")
DJANGO_RUN = {**{m: S for m in ("get", "first", "last", "count", "exists", "aggregate",
                                "in_bulk", "earliest", "latest", "iterator", "contains")},
              "create": I, "bulk_create": I, "update": U, "bulk_update": U, "delete": D,
              "get_or_create": SV, "update_or_create": SV}
SA_QUERY_RUN = {**{m: S for m in ("all", "first", "one", "one_or_none", "scalar", "get",
                                  "get_or_404", "first_or_404", "one_or_404", "count",
                                  "paginate")},
                "delete": D, "update": U}
SA_SESSION_EXEC = ("exec", "execute", "scalars", "scalar", "scalar_one", "scalar_one_or_none")
SA_STATEMENTS = {"select": S, "insert": I, "update": U, "delete": D}
JDBC = ("query", "queryForObject", "queryForList", "queryForMap", "queryForRowSet",
        "queryForStream", "update", "batchUpdate", "execute")
RAW = ("query", "execute", "executemany", "executeQuery", "executeUpdate", "raw")

SQLALCHEMY_SPECS = ("sqlalchemy", "sqlmodel", "sqlalchemy.orm", "sqlalchemy.future",
                    "sqlalchemy.sql", "sqlalchemy.ext.asyncio", "sqlmodel.ext.asyncio.session")
DRIVER_SPECS = {
    "js": ("pg", "mysql", "mysql2", "mysql2/promise", "sqlite3", "better-sqlite3", "knex",
           "typeorm", "@prisma/client"),
    "py": ("django.db", "sqlite3", "psycopg", "psycopg2", "pymysql", "MySQLdb", "asyncpg",
           "sqlalchemy", "sqlmodel"),
    "java": ("java.sql", "javax.sql", "org.springframework.jdbc"),
}
SPRING_BASES = ("JpaRepository", "CrudRepository", "ListCrudRepository",
                "PagingAndSortingRepository", "ListPagingAndSortingRepository", "Repository",
                "JpaSpecificationExecutor", "QueryByExampleExecutor")
SPRING_BUILTINS = {**{m: S for m in ("findAll", "findAllById", "findById", "getById",
                                     "getReferenceById", "getOne", "count", "existsById")},
                   **{m: SV for m in ("save", "saveAll", "saveAndFlush", "saveAllAndFlush")},
                   **{m: D for m in ("delete", "deleteById", "deleteAll", "deleteAllById",
                                     "deleteAllInBatch", "deleteInBatch",
                                     "deleteAllByIdInBatch")}}


def _ident(node: Node | None) -> str | None:
    node = _unwrap(node)
    if node is None:
        return None
    if node.type in ("identifier", "type_identifier"):
        return _t(node)
    if node.type in ("attribute", "member_expression", "field_access") and \
            re.fullmatch(r"[\w$]+(\.[\w$]+)*", _t(node)):
        return _t(node)
    return None


def _orm(kind: str, orm: str, op: str, target: str | None, text: str, **extra) -> dict:
    return {"kind": kind, "orm": orm, "op": op, "target": target, **capped(text), **extra}


def _cand(at: int, query: dict, evidence: list[list[dict]], entity: dict | None = None,
          builder: bool = False) -> dict:
    """A candidate query on call `at`; `evidence`: alternatives, each a list of checks
    that must all pass; `entity`: how to resolve the target to a repo entity."""
    return {"at": at, "query": query, "evidence": evidence, "entity": entity,
            "builder": builder}


def _executes(c: dict, value: str, note: str | None = None) -> dict:
    c["query"]["executes"] = value
    if note:
        c["query"]["executesNote"] = note
    return c


# --- recognizers: (links, use) → candidates, most specific first ---------------------
# Several libraries can share a shape (`x.query(…)` is TypeORM, a pg pool, or nothing);
# each recognizer offers a candidate with the evidence it needs, and the linker keeps
# the first one whose evidence holds.

def _strip_then(lang: str, links: list[Link], use: dict) -> tuple[list[Link], dict]:
    """`chain.then(…)` / `.catch(…)`: the chain runs; the then-links aren't part of it."""
    if lang != "js":
        return links, use
    n = len(links)
    while n > 1 and links[n - 1].name in ("then", "catch", "finally"):
        n -= 1
    if n < len(links):
        return links[:n], {**use, "use": "then"}
    return links, use


def _lazy(c: dict, runs: bool, run_at: int, family: str) -> dict:
    """A lazy chain: run here (on `run_at`) or only built here (stays on its builder)."""
    if runs:
        c["at"] = run_at
        return _executes(c, "terminal")
    c["builder"] = True
    c["family"] = family
    return _executes(c, "unknown")


def _js_prisma(links: list[Link], use: dict, text: str) -> dict | None:
    first = links[0]
    rec = first.receiver
    if len(links) != 1 or not rec or rec.startswith("<"):
        return None
    runs = use["awaited"] or use["use"] == "then"
    if "." in rec and first.name in PRISMA:
        root, model = rec.rsplit(".", 1)
        c = _cand(first.index, _orm("orm", "prisma", PRISMA[first.name], model, text),
                  [[{"prisma": root}]])
        return _executes(c, "terminal" if runs else "unknown")
    if first.name in PRISMA_RAW and first.args:
        lit = literal("js", first.args[0])
        tagged = first.args[0].type == "template_string"
        # A tagged template's ${…} parts are bound parameters; a string's aren't.
        sql = lit[0].replace("{…}", "?") if lit else ""
        q = sql_query(sql, "prisma", lit is not None and (lit[1] or tagged))
        c = _cand(first.index, q, [[{"prisma": rec}]])
        return _executes(c, "terminal" if runs else "unknown")
    return None


def _js_typeorm(links: list[Link], use: dict, text: str) -> dict | None:
    first = links[0]
    rec = first.receiver
    entity_arg, base = None, 0
    if first.name == "getRepository" and first.args and _ident(first.args[0]):
        entity_arg, base = _ident(first.args[0]), 1
        ev = [[{"typeorm": rec}]] if rec else [[{"module": "getRepository", "specs": ["typeorm"]}]]
    elif rec and not rec.startswith("<"):
        ev = [[{"typeorm": rec}]]
    else:
        return None
    if len(links) <= base:
        return None
    head = links[base]
    ent = {"type": entity_arg, "orms": ["typeorm"]} if entity_arg else \
        {"receiverArg": rec, "orms": ["typeorm"]}
    target = entity_arg
    if head.name == "createQueryBuilder":
        rest = links[base + 1:]
        ops = [ln.name for ln in rest]
        op = UP if any(o in ("orUpdate", "orIgnore") for o in ops) else \
            I if "insert" in ops else U if "update" in ops else \
            D if any(o in ("delete", "softDelete") for o in ops) else S
        for ln in rest:
            if ln.name in ("from", "into", "update") and ln.args and _ident(ln.args[0]):
                target = _ident(ln.args[0])
                ent = {"type": target, "orms": ["typeorm"]}
        c = _cand(head.index, _orm("orm", "typeorm", op, target, text), ev, ent)
        term = next((ln for ln in rest if ln.name in QB_TERMINAL), None)
        return _lazy(c, term is not None, term.index if term else head.index, "typeorm-qb")
    if len(links) == base + 1 and head.name in TYPEORM_REPO:
        c = _cand(head.index, _orm("orm", "typeorm", TYPEORM_REPO[head.name], target, text),
                  ev, ent)
        return _executes(c, "yes")
    if len(links) == base + 1 and head.name == "query" and head.args:
        lit = literal("js", head.args[0])
        q = sql_query(lit[0] if lit else "", "typeorm", bool(lit and lit[1]))
        return _executes(_cand(head.index, q, ev), "yes")
    return None


KNEX_START = ("select", "insert", "update", "del", "delete", "from", "into", "table",
              "where", "count", "first", "pluck")


def _js_knex(links: list[Link], use: dict, text: str) -> dict | None:
    first, last = links[0], links[-1]
    rec = first.receiver
    runs = use["awaited"] or use["use"] == "then"
    if rec is None:
        if not first.args:
            return None  # `f()`: not a table
        root = first.name
    elif re.fullmatch(r"[\w$]+", rec) and first.name in KNEX_START + ("raw",):
        root = rec
    else:
        return None
    ev = [[{"knex": root}]]
    if first.name == "raw" and rec is not None:
        lit = literal("js", first.args[0]) if first.args else None
        q = sql_query(lit[0] if lit else "", "knex", bool(lit and lit[1]))
        return _executes(_cand(first.index, q, ev), "terminal" if runs else "unknown")
    target = None
    if rec is None:
        lt = literal("js", first.args[0])
        target = lt[0] if lt and lt[1] else None
    for ln in links:
        if ln.name in ("from", "into", "table") and ln.args:
            lt = literal("js", ln.args[0])
            target = lt[0] if lt and lt[1] else target
    ops = [ln.name for ln in links]
    op = UP if "onConflict" in ops and any(o in ("merge", "ignore") for o in ops) else \
        I if "insert" in ops else U if "update" in ops else \
        D if any(o in ("del", "delete", "truncate") for o in ops) else S
    c = _cand(first.index, _orm("orm", "knex", op, target, text), ev)
    return _lazy(c, runs, last.index, "knex")


def _raw(lang: str, links: list[Link], root: str | None, text: str) -> dict | None:
    """Raw SQL through a driver: pool.query(sql), cursor.execute(sql), stmt.executeQuery."""
    first = links[0]
    if len(links) != 1 or not first.receiver or first.receiver.startswith("<") or \
            first.name not in RAW or not first.args:
        return None
    lit = literal(lang, first.args[0])
    plain = bool(lit and lit[1])
    q = sql_query(lit[0] if lit else "", "driver", plain)
    alts = []
    if root:
        alts.append([{"driver": root, "specs": list(DRIVER_SPECS[lang])}])
    if plain and in_subset(lit[0]):
        alts.append([{"literal": True}])
    return _executes(_cand(first.index, q, alts), "yes") if alts else None


def _py_django(links: list[Link], use: dict, text: str) -> dict | None:
    first, last = links[0], links[-1]
    m = re.fullmatch(r"([\w.]+)\.(objects|_default_manager)", first.receiver or "")
    if m is None:
        return None
    model = m.group(1)
    ev = [[{"model": model, "orms": ["django"]}]]
    ent = {"model": model, "orms": ["django"]}
    if first.name == "raw" and len(links) == 1:
        lit = literal("py", first.args[0]) if first.args else None
        q = sql_query(lit[0] if lit else "", "django", bool(lit and lit[1]))
        return _executes(_cand(first.index, q, ev, ent), "unknown",
                         "a RawQuerySet runs when it's iterated")
    for ln in links:
        if ln.name in DJANGO_RUN:
            c = _cand(ln.index, _orm("orm", "django", DJANGO_RUN[ln.name], model, text), ev, ent)
            return _executes(c, "terminal")
        if ln.name not in DJANGO_LAZY:
            return None
    c = _cand(first.index, _orm("orm", "django", S, model, text), ev, ent)
    return _lazy(c, use["use"] == "iterated", last.index, "django")


def _py_sa_query(links: list[Link], use: dict, text: str) -> dict | None:
    """Flask-SQLAlchemy `X.query.<…>` and SQLAlchemy `session.query(X).<…>`."""
    first, last = links[0], links[-1]
    rec = first.receiver
    m = re.fullmatch(r"([\w.]+)\.query", rec or "")
    if m is not None:
        model, rest = m.group(1), links
    elif first.name == "query" and rec and not rec.startswith("<") and first.args and \
            _ident(first.args[0]):
        model, rest = _ident(first.args[0]), links[1:]
    else:
        return None
    ev = [[{"model": model, "orms": ["sqlalchemy", "sqlmodel"]}]]
    ent = {"model": model, "orms": ["sqlalchemy", "sqlmodel"]}
    for ln in rest:
        if ln.name in SA_QUERY_RUN:
            c = _cand(ln.index, _orm("orm", "sqlalchemy", SA_QUERY_RUN[ln.name], model, text),
                      ev, ent)
            return _executes(c, "terminal")
    c = _cand(first.index, _orm("orm", "sqlalchemy", S, model, text), ev, ent)
    return _lazy(c, use["use"] == "iterated", last.index, "sa-query")


def _py_statement(links: list[Link], use: dict, text: str) -> dict | None:
    """`select(X).where(…)`: a statement object, run by session.exec/execute."""
    first = links[0]
    if first.receiver is not None or first.name not in SA_STATEMENTS or not first.args:
        return None
    model = _ident(first.args[0])
    ev = [[{"module": first.name, "specs": list(SQLALCHEMY_SPECS)}]]
    ent = {"model": model, "orms": ["sqlalchemy", "sqlmodel"]} if model else None
    c = _cand(first.index, _orm("orm", "sqlalchemy", SA_STATEMENTS[first.name], model, text),
              ev, ent)
    c["builder"] = True
    c["family"] = "sa-statement"
    return _executes(c, "unknown")


def _py_session(links: list[Link], use: dict, text: str, built: dict[str, str]) -> dict | None:
    """session.get(X, id); session.add(obj) / session.delete(obj)."""
    first = links[0]
    rec = first.receiver
    if len(links) != 1 or not rec or rec.startswith("<"):
        return None
    sa = ["sqlalchemy", "sqlmodel"]
    if first.name == "get" and len(first.args) >= 2 and _ident(first.args[0]):
        model = _ident(first.args[0])
        c = _cand(first.index, _orm("orm", "sqlalchemy", S, model, text),
                  [[{"model": model, "orms": sa}]], {"model": model, "orms": sa})
        return _executes(c, "yes")
    if first.name in ("add", "delete") and len(first.args) == 1:
        arg = _ident(first.args[0])
        model = built.get(arg) if arg else None  # `obj = X(…)` in this function
        op = D if first.name == "delete" else (I if model else "UNKNOWN")
        checks = [{"session": rec}] + ([{"model": model, "orms": sa}] if model else [])
        c = _cand(first.index, _orm("orm", "sqlalchemy", op, model, text), [checks],
                  {"model": model, "orms": sa} if model else None)
        return _executes(c, "unknown", "written when the session commits or flushes")
    return None


def _java_jdbc(links: list[Link], use: dict, text: str) -> dict | None:
    first = links[0]
    if len(links) != 1 or not first.receiver or first.name not in JDBC or not first.args:
        return None
    lit = literal("java", first.args[0])
    q = sql_query(lit[0] if lit else "", "jdbc", lit is not None)
    alts = [[{"jdbc": first.receiver}]]
    if lit and in_subset(lit[0]):
        alts.append([{"literal": True}])
    return _executes(_cand(first.index, q, alts), "yes")


def recognize(lang: str, links: list[Link], use: dict, text: str,
              built: dict[str, str], cursors: dict[str, str]) -> list[dict]:
    links, use = _strip_then(lang, links, use)
    root = links[0].receiver.split(".")[0] if links[0].receiver else None
    if lang == "js":
        found = [_js_prisma(links, use, text), _js_typeorm(links, use, text),
                 _js_knex(links, use, text), _raw("js", links, root, text)]
    elif lang == "py":
        found = [_py_django(links, use, text), _py_sa_query(links, use, text),
                 _py_statement(links, use, text), _py_session(links, use, text, built),
                 _raw("py", links, cursors.get(root, root) if root else None, text)]
    else:
        found = [_java_jdbc(links, use, text), _raw("java", links, None, text)]
    return [c for c in found if c is not None]


# --- per function ---------------------------------------------------------------------

NESTED = {"js": ("function_declaration", "generator_function_declaration", "class_declaration",
                 "class", "arrow_function", "function_expression", "method_definition"),
          "py": ("function_definition", "class_definition", "lambda"),
          "java": ("class_declaration", "lambda_expression", "class_body",
                   "interface_declaration")}
FOR_RIGHT = {"js": ("for_in_statement", "right"), "py": ("for_statement", "right"),
             "java": ("enhanced_for_statement", "value")}


def _walk_own(lang: str, fn_node: Node):
    """The function's own nodes: not those of nested functions or classes."""
    stack = list(reversed(fn_node.children))
    while stack:
        n = stack.pop()
        yield n
        if n.type in NESTED[lang]:
            continue
        stack.extend(reversed(n.children))


def _assignments(lang: str, fn_node: Node) -> tuple[dict[str, int], dict[str, Node]]:
    """How often each local name is assigned, and its (last) assigned value."""
    count: dict[str, int] = {}
    value: dict[str, Node] = {}
    for n in _walk_own(lang, fn_node):
        name = val = None
        if n.type == "variable_declarator":
            name, val = n.child_by_field_name("name"), n.child_by_field_name("value")
        elif n.type in ("assignment_expression", "assignment", "augmented_assignment",
                        "augmented_assignment_expression"):
            name, val = n.child_by_field_name("left"), n.child_by_field_name("right")
            if n.type.startswith("augmented"):
                val = None
        elif n.type == "as_pattern" and lang == "py":  # with x.cursor() as name
            kids = n.named_children
            if len(kids) == 2:
                val = kids[0]
                tgt = kids[1]
                name = tgt.named_children[0] if tgt.type == "as_pattern_target" and \
                    tgt.named_children else tgt
        if name is None or name.type != "identifier":
            continue
        key = _t(name)
        count[key] = count.get(key, 0) + 1
        if val is not None:
            value[key] = val
    return count, value


def _derived_locals(lang: str, values: dict[str, Node]) -> tuple[dict[str, str], dict[str, str]]:
    """`built`: obj → X for `obj = X(…)` / `X.model_validate(…)` (Python);
    `cursors`: local → the identifier it came from (`cur = conn.cursor()`,
    `client = await pool.connect()`), followed up to three hops."""
    built: dict[str, str] = {}
    origin: dict[str, str] = {}
    for name, val in values.items():
        v = _unwrap(val)
        if v is not None and v.type in ("await_expression", "await") and v.named_children:
            v = _unwrap(v.named_children[0])
        if v is None or v.type not in CALL[lang]:
            continue
        obj, method = _callee(lang, v)
        if lang == "py" and obj is None and re.fullmatch(r"[A-Z]\w*", method):
            built[name] = method
        elif lang == "py" and obj is not None and method in ("model_validate", "from_orm") and \
                _ident(obj):
            built[name] = _ident(obj)
        root = _ident(obj) if obj is not None else None
        if root and "." not in root:
            origin[name] = root
    cursors: dict[str, str] = {}
    for name in origin:
        cur, seen = name, 0
        while cur in origin and seen < 3:
            cur, seen = origin[cur], seen + 1
        cursors[name] = cur
    return built, cursors


def _iterated(lang: str, fn_node: Node, name: str) -> bool:
    kind, field = FOR_RIGHT[lang]
    for n in _walk_own(lang, fn_node):
        if n.type == kind or (lang == "py" and n.type == "for_in_clause"):
            r = _unwrap(n.child_by_field_name("right" if n.type == "for_in_clause" else field))
            if r is not None and _t(r) == name:
                return True
        if lang == "py" and n.type == "call":
            fn = n.child_by_field_name("function")
            args = n.child_by_field_name("arguments")
            if fn is not None and _t(fn) in ("list", "len", "tuple") and args is not None and \
                    [_t(a) for a in args.named_children] == [name]:
                return True
    return False


def _consumer(lang: str, c: dict, links: list[Link], use: dict) -> tuple[int, str, str] | None:
    """Does a chain continuing a stored builder run it? (call index, op, executes); the
    caller adds the consuming expression's text."""
    links, use = _strip_then(lang, links, use)
    names = c["names"] + [ln.name for ln in links]
    fam = c["family"]
    if fam == "typeorm-qb":
        term = next((ln for ln in links if ln.name in QB_TERMINAL), None)
        if term is None:
            return None
        op = UP if any(o in ("orUpdate", "orIgnore") for o in names) else \
            I if "insert" in names else U if "update" in names else \
            D if any(o in ("delete", "softDelete") for o in names) else S
        return term.index, op, "terminal"
    if fam == "knex":
        if not (use["awaited"] or use["use"] == "then"):
            return None
        op = UP if "onConflict" in names and any(o in ("merge", "ignore") for o in names) else \
            I if "insert" in names else U if "update" in names else \
            D if any(o in ("del", "delete", "truncate") for o in names) else S
        return links[-1].index, op, "terminal"
    if fam == "django":
        run = next((ln for ln in links if ln.name in DJANGO_RUN), None)
        if run is not None:
            return run.index, DJANGO_RUN[run.name], "terminal"
        if use["use"] == "iterated" and all(ln.name in DJANGO_LAZY for ln in links):
            return links[-1].index, S, "terminal"
        return None
    if fam == "sa-query":
        run = next((ln for ln in links if ln.name in SA_QUERY_RUN), None)
        if run is not None:
            return run.index, SA_QUERY_RUN[run.name], "terminal"
        return None
    return None


def detect(lang: str, calls: list, nodes: list[Node], fn_node: Node) -> None:
    """Sets `db` on the calls that carry a detected query: a list of alternatives
    `{query, evidence, entity}` for the linker to confirm (first confirmed wins)."""
    if lang not in CALL:
        return
    at = {(n.start_byte, n.end_byte, n.type): k for k, n in enumerate(nodes)}

    def index_of(n: Node) -> int | None:
        return at.get((n.start_byte, n.end_byte, n.type))

    count, values = _assignments(lang, fn_node)
    built, cursors = _derived_locals(lang, values)
    tops = []
    for k, n in enumerate(nodes):
        if n.type not in CALL[lang] or _is_link_object(lang, n):
            continue
        links = chain_of(lang, n, index_of)
        if not links:
            continue
        for ln in links:
            ln.receiver = calls[ln.index].receiver
        tops.append((n, links, use_of(lang, n)))

    def put(k: int, c: dict) -> None:
        alt = {"query": c["query"], "evidence": c["evidence"], "entity": c["entity"]}
        calls[k].db = (calls[k].db or []) + [alt]

    for n, links, use in tops:
        text = _flat(n)
        for c in recognize(lang, links, use, text, built, cursors):
            if not c["builder"]:
                put(c["at"], c)
                continue
            c["names"] = [ln.name for ln in _strip_then(lang, links, use)[0]]
            consumers = []
            if use["use"] == "passed" and c["family"] == "sa-statement" and \
                    use.get("call") is not None:
                k = index_of(use["call"])
                if k is not None and calls[k].name in SA_SESSION_EXEC:
                    consumers.append((k, c["query"]["op"], "yes", None))
            elif use["use"] == "stored" and count.get(use["name"]) == 1:
                v = use["name"]
                for n2, links2, use2 in tops:
                    if links2[0].receiver == v:
                        hit = _consumer(lang, c, links2, use2)
                        if hit is not None:
                            consumers.append((*hit, _flat(n2)))
                if c["family"] == "sa-statement":
                    for k, call in enumerate(calls):
                        if call.name in SA_SESSION_EXEC and any(
                                _t(_unwrap(a)) == v for a in _args(nodes[k])):
                            consumers.append((k, c["query"]["op"], "yes", _flat(nodes[k])))
                if not consumers and c["family"] in ("django", "sa-query") and \
                        _iterated(lang, fn_node, v):
                    _executes(c, "terminal", f"runs when {v} is iterated")
            if not consumers:
                put(c["at"], c)
                continue
            for k, op, executes, via in consumers:
                # The builder's text, then the call that runs it: `… → qb.getMany()`.
                text = f"{c['query']['text']} → {via}" if via else c["query"]["text"]
                q = {**c["query"], "op": op, "executes": executes, **capped(text)}
                put(k, {"query": q, "evidence": c["evidence"], "entity": c["entity"]})
