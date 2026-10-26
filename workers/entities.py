"""ORM entity detection (repograph-spec.md §12) on an already-parsed file.

Works on the class nodes extract.py's types query has already found, so a file is
still parsed once. Relationship targets are kept as written (`'app.Tag'`,
`com.x.Tag`) except `'self'`, which becomes the owning class; they're resolved to
entities in the app, within the same language and ORM only.
"""

import re
from dataclasses import dataclass, field

from tree_sitter import Node

# The cardinality labels the ER view draws (§12); SQLAlchemy's `relationship()` says
# nothing about cardinality, hence the generic one.
ONE_ONE, ONE_MANY, MANY_ONE, MANY_MANY, RELATED = "1–1", "1–N", "N–1", "N–N", "RelatedTo"

# JPA annotations and TypeORM decorators share these names.
RELATION_KINDS = {"OneToOne": ONE_ONE, "OneToMany": ONE_MANY, "ManyToOne": MANY_ONE,
                  "ManyToMany": MANY_MANY}
DJANGO_RELATIONS = {"ForeignKey": MANY_ONE, "OneToOneField": ONE_ONE,
                    "ManyToManyField": MANY_MANY}


@dataclass(frozen=True)
class Field:
    name: str
    type: str
    pk: bool = False


@dataclass(frozen=True)
class Relation:
    field: str
    kind: str  # 1–1 | 1–N | N–1 | N–N | RelatedTo
    target: str


@dataclass
class Entity:
    name: str
    table: str  # the declared table name, else the class name
    orm: str  # jpa | typeorm | django | sqlalchemy | sqlmodel
    fields: list[Field] = field(default_factory=list)
    relations: list[Relation] = field(default_factory=list)
    line: int = 0  # 1-based


def _text(node: Node | None) -> str:
    if node is None or node.text is None:
        return ""
    return node.text.decode("utf-8", errors="replace")


def _last(dotted: str) -> str:
    return dotted[dotted.rfind(".") + 1:]


def _string(node: Node | None) -> str | None:
    """A plain string literal's value, in any of the three grammars."""
    if node is None or node.type not in ("string", "string_literal"):
        return None
    inner = [c for c in node.named_children if c.type not in ("string_start", "string_end")]
    parts = [c for c in inner if c.type in ("string_fragment", "string_content")]
    if len(parts) != len(inner):
        return None  # interpolated (f-string, template) or escaped: not a static name
    return "".join(_text(p) for p in parts)


# ---------------------------------------------------------------- JPA / Hibernate


def _annotations(node: Node) -> dict[str, Node]:
    """`@a.b.Name(...)` / `@Name` on a Java declaration, by simple name."""
    mods = next((c for c in node.children if c.type == "modifiers"), None)
    out: dict[str, Node] = {}
    for a in mods.named_children if mods is not None else []:
        if a.type in ("annotation", "marker_annotation"):
            out.setdefault(_last(_text(a.child_by_field_name("name"))), a)
    return out


def _annotation_arg(annotation: Node, key: str) -> Node | None:
    args = annotation.child_by_field_name("arguments")
    for pair in args.named_children if args is not None else []:
        if pair.type == "element_value_pair" and _text(pair.child_by_field_name("key")) == key:
            return pair.child_by_field_name("value")
    return None


def _java_target(type_node: Node) -> str:
    """`List<Order>` → `Order`, `Map<K, V>` → `V`, `Customer` → `Customer`."""
    if type_node.type == "generic_type":
        args = next((c for c in type_node.named_children if c.type == "type_arguments"), None)
        if args is not None and args.named_children:
            return _java_target(args.named_children[-1])
        return _text(type_node.named_children[0]) if type_node.named_children else ""
    return _text(type_node)


def jpa_entity(cls: Node) -> Entity | None:
    anns = _annotations(cls)
    name = cls.child_by_field_name("name")
    if "Entity" not in anns or name is None:
        return None
    table = _string(_annotation_arg(anns["Table"], "name")) if "Table" in anns else None
    entity = Entity(_text(name), table or _text(name), "jpa", line=cls.start_point[0] + 1)
    body = cls.child_by_field_name("body")
    for member in body.named_children if body is not None else []:
        if member.type != "field_declaration":
            continue
        fa = _annotations(member)
        type_node = member.child_by_field_name("type")
        names = [_text(d.child_by_field_name("name"))
                 for d in member.children_by_field_name("declarator")]
        rel = next((RELATION_KINDS[a] for a in fa if a in RELATION_KINDS), None)
        if rel is not None and type_node is not None:
            target = _java_target(type_node)
            entity.relations.extend(Relation(n, rel, target) for n in names)
        elif "Id" in fa or "Column" in fa:
            entity.fields.extend(Field(n, _text(type_node), "Id" in fa) for n in names)
    return entity


# ---------------------------------------------------------------- TypeORM


def _decorators(node: Node) -> dict[str, Node]:
    """Decorators by name → their argument list node (or the decorator itself when it
    isn't called, `@Entity`). A class exported with `@Entity() export class` carries
    them on the export statement."""
    nodes = node.children_by_field_name("decorator")
    if node.parent is not None and node.parent.type == "export_statement":
        nodes = node.parent.children_by_field_name("decorator") + nodes
    out: dict[str, Node] = {}
    for d in nodes:
        expr = d.named_children[0] if d.named_children else None
        if expr is None:
            continue
        if expr.type == "call_expression":
            out.setdefault(_last(_text(expr.child_by_field_name("function"))),
                           expr.child_by_field_name("arguments"))
        elif expr.type in ("identifier", "member_expression"):
            out.setdefault(_last(_text(expr)), expr)
    return out


def _args(args: Node | None) -> list[Node]:
    return args.named_children if args is not None and args.type == "arguments" else []


def _ts_table(args: Node | None) -> str | None:
    """`@Entity("users")` or `@Entity({ name: "users" })`."""
    for a in _args(args)[:1]:
        if (s := _string(a)) is not None:
            return s
        if a.type == "object":
            for pair in a.named_children:
                if pair.type == "pair" and _text(pair.child_by_field_name("key")) == "name":
                    return _string(pair.child_by_field_name("value"))
    return None


def _ts_target(args: Node | None) -> str | None:
    """The first argument of a relation decorator: `() => Photo`, `type => Photo`,
    or the entity's name as a string."""
    first = next(iter(_args(args)), None)
    if first is None:
        return None
    if first.type == "arrow_function":
        body = first.child_by_field_name("body")
        if body is not None and body.type in ("identifier", "member_expression"):
            return _text(body)
        return None
    return _string(first)


def typeorm_entity(cls: Node) -> Entity | None:
    decs = _decorators(cls)
    name = cls.child_by_field_name("name")
    if "Entity" not in decs or name is None:
        return None
    entity = Entity(_text(name), _ts_table(decs["Entity"]) or _text(name), "typeorm",
                    line=cls.start_point[0] + 1)
    body = cls.child_by_field_name("body")
    for member in body.named_children if body is not None else []:
        if member.type not in ("public_field_definition", "field_definition"):
            continue
        fd = _decorators(member)
        prop = _text(member.child_by_field_name("name")
                     or member.child_by_field_name("property"))
        rel = next((RELATION_KINDS[d] for d in fd if d in RELATION_KINDS), None)
        if rel is not None:
            target = _ts_target(fd[next(d for d in fd if d in RELATION_KINDS)])
            if target:
                entity.relations.append(Relation(prop, rel, target))
            continue
        pk = "PrimaryColumn" in fd or "PrimaryGeneratedColumn" in fd
        if pk or "Column" in fd:
            ann = member.child_by_field_name("type")  # `: number` (TS only)
            typ = _text(ann).lstrip(":").strip() if ann is not None else ""
            entity.fields.append(Field(prop, typ, pk))
    return entity


# ---------------------------------------------------------------- Django / SQLAlchemy


def _assignments(cls: Node) -> list[tuple[str, Node]]:
    """`name = <expr>` statements directly in the class body (not in methods or a
    nested `class Meta`)."""
    body = cls.child_by_field_name("body")
    out = []
    for stmt in body.named_children if body is not None else []:
        if stmt.type != "expression_statement" or not stmt.named_children:
            continue
        a = stmt.named_children[0]
        left, right = a.child_by_field_name("left"), a.child_by_field_name("right")
        if a.type == "assignment" and left is not None and left.type == "identifier" \
                and right is not None:
            out.append((_text(left), right))
    return out


def _call(node: Node) -> tuple[str, list[Node], dict[str, Node]] | None:
    """`f(a, b, k=v)` → (`f` as written, positional args, keyword args)."""
    if node.type != "call":
        return None
    args = node.child_by_field_name("arguments")
    pos, kw = [], {}
    for a in args.named_children if args is not None else []:
        if a.type == "keyword_argument":
            kw[_text(a.child_by_field_name("name"))] = a.child_by_field_name("value")
        elif a.type not in ("comment", "list_splat", "dictionary_splat"):
            pos.append(a)
    return _text(node.child_by_field_name("function")), pos, kw


def _bases(cls: Node) -> list[str]:
    sup = cls.child_by_field_name("superclasses")
    return [_text(b) for b in (sup.named_children if sup is not None else [])
            if b.type != "keyword_argument"]


def _py_target(node: Node | None, owner: str) -> str | None:
    if node is None:
        return None
    name = _string(node)
    if name is None and node.type in ("identifier", "attribute"):
        name = _text(node)
    if name == "self":
        return owner
    return name or None


def _django_table(cls: Node) -> str | None:
    """`class Meta: db_table = "…"` inside the model."""
    body = cls.child_by_field_name("body")
    for inner in body.named_children if body is not None else []:
        if inner.type == "class_definition" and _text(inner.child_by_field_name("name")) == "Meta":
            return next((_string(v) for a, v in _assignments(inner) if a == "db_table"), None)
    return None


def django_entity(cls: Node) -> Entity | None:
    name = _text(cls.child_by_field_name("name"))
    if "models.Model" not in _bases(cls) or not name:
        return None
    entity = Entity(name, _django_table(cls) or name, "django", line=cls.start_point[0] + 1)
    for attr, value in _assignments(cls):
        call = _call(value)
        if call is None or not call[0].startswith("models."):
            continue
        fn, pos, kw = call
        kind = _last(fn)
        pk = _text(kw.get("primary_key")) == "True"
        entity.fields.append(Field(attr, kind, pk))
        if kind in DJANGO_RELATIONS:
            to = kw.get("to")
            target = _py_target(to if to is not None else next(iter(pos), None), name)
            if target:
                entity.relations.append(Relation(attr, DJANGO_RELATIONS[kind], target))
    if not any(f.pk for f in entity.fields):  # Django adds `id` unless a pk is declared
        entity.fields.insert(0, Field("id", "AutoField", True))
    return entity


def sqlalchemy_entity(cls: Node) -> Entity | None:
    name = _text(cls.child_by_field_name("name"))
    assigns = _assignments(cls)
    tablename = next((_string(v) for a, v in assigns if a == "__tablename__"), None)
    if not name or (tablename is None and "db.Model" not in _bases(cls)):
        return None
    entity = Entity(name, tablename or name, "sqlalchemy", line=cls.start_point[0] + 1)
    for attr, value in assigns:
        call = _call(value)
        if call is None:
            continue
        fn, pos, kw = call
        if _last(fn) == "Column":
            # `Column("db_name", Integer, …)`: the type is the first non-string argument.
            typ = next((_text(p) for p in pos if _string(p) is None), "")
            entity.fields.append(Field(attr, typ, _text(kw.get("primary_key")) == "True"))
        elif _last(fn) == "relationship":
            target = _py_target(next(iter(pos), None), name)
            if target:
                entity.relations.append(Relation(attr, RELATED, target))
    return entity


def sqlmodel_entity(cls: Node) -> Entity | None:
    """`class Hero(SQLModel, table=True)` (or a table subclass of a SQLModel model):
    only `table=True` classes are tables."""
    name = _text(cls.child_by_field_name("name"))
    sup = cls.child_by_field_name("superclasses")
    table = any(a.type == "keyword_argument" and _text(a.child_by_field_name("name")) == "table"
                and _text(a.child_by_field_name("value")) == "True"
                for a in (sup.named_children if sup is not None else []))
    if not name or not table:
        return None
    assigns = _assignments(cls)
    tablename = next((_string(v) for a, v in assigns if a == "__tablename__"), None)
    entity = Entity(name, tablename or name.lower(), "sqlmodel", line=cls.start_point[0] + 1)
    body = cls.child_by_field_name("body")
    for stmt in body.named_children if body is not None else []:
        a = stmt.named_children[0] if stmt.type == "expression_statement" and \
            stmt.named_children else None
        if a is None or a.type != "assignment":
            continue
        left, typ, right = (a.child_by_field_name(k) for k in ("left", "type", "right"))
        if left is None or left.type != "identifier" or typ is None:
            continue
        call = _call(right) if right is not None else None
        if call is not None and _last(call[0]) == "Relationship":
            target = next((m for m in re.findall(r"[A-Z]\w*", _text(typ))
                           if m not in ("Optional", "List", "None")), None)
            if target:
                entity.relations.append(Relation(_text(left), RELATED, target))
            continue
        pk = call is not None and _last(call[0]) == "Field" and \
            _text(call[2].get("primary_key")) == "True"
        entity.fields.append(Field(_text(left), _text(typ), pk))
    return entity


def extract_entities(lang: str, classes: list[Node]) -> list[Entity]:
    """Every ORM entity among a file's class declarations."""
    if lang == "java":
        detectors = [jpa_entity]
    elif lang == "py":
        detectors = [django_entity, sqlmodel_entity, sqlalchemy_entity]
    else:
        detectors = [typeorm_entity]
    out = []
    for cls in classes:
        entity = next((e for d in detectors if (e := d(cls)) is not None), None)
        if entity is not None:
            out.append(entity)
    return out
