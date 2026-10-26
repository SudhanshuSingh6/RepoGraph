"""The calls made inside each recorded function, and its typed local variables, for the
APIs view's call flows. Syntax only; flow_link.py resolves each call to its target.
structure.py walks each function body and uses the recognizers here.

A call belongs to the innermost *recorded* function around it (flows.py decides which
functions are recorded). Calls inside an unrecorded lambda or callback count toward
the enclosing function, marked `guarded`: a callback may never run.

`guarded` is true when the call sits on a path that may not execute: an if/else branch
(not the condition), a switch case, a loop body (not a while/for condition's first
check), a catch/except, the right side of a short-circuit operator, an optional call,
a comprehension's element, a callback. structure.py sets it while building the tree.
"""

from dataclasses import dataclass

from tree_sitter import Node

DYNAMIC = "<expr>"  # a computed callee: `a[b]()`, `f()()`, `getRepo().find()`


@dataclass
class Call:
    receiver: str | None  # None for a bare `f()`; 'this' / 'self' / 'super' / a dotted chain
    name: str
    line: int
    guarded: bool
    args: int = 0
    new: bool = False  # `new T()` / Java `new T()`: a constructor call
    # Only runs when a short-circuit / ternary / optional-chain condition holds:
    # {op: '&&' | '||' | '??' | 'and' | 'or' | '?' | '?.', left: text, branch?: bool}
    when: dict | None = None
    # Inside an unrecorded function value: 'then' (.then/.catch/.finally), 'timer'
    # (setTimeout & co.) or 'callback' (any other function argument): runs later, if at all.
    context: str | None = None
    awaited: bool = False  # the direct operand of `await`
    # Detected DB query alternatives on this call (queries.py), confirmed or dropped by
    # flow_link.py; stored as `query`.
    db: list | None = None


@dataclass
class Local:
    name: str
    type: str
    ctor: bool = False  # Python `x = T(…)`: T only counts if it resolves to a class


def _text(node: Node | None) -> str:
    return node.text.decode("utf-8", errors="replace") if node is not None and node.text else ""


def _line(node: Node) -> int:
    return node.start_point[0] + 1


def _argc(args: Node | None) -> int:
    if args is None:
        return 0
    return sum(1 for c in args.named_children if c.type not in ("comment",))


# --- receivers -----------------------------------------------------------------------

def _js_chain(node: Node | None) -> str | None:
    """`this.repo` / `a.b.c` / `x` as text; None if any link isn't a plain name."""
    if node is None:
        return None
    if node.type in ("identifier", "this", "super"):
        return _text(node)
    if node.type == "member_expression":
        obj = _js_chain(node.child_by_field_name("object"))
        prop = node.child_by_field_name("property")
        if obj is None or prop is None or prop.type not in ("property_identifier",
                                                           "private_property_identifier"):
            return None
        return f"{obj}.{_text(prop)}"
    if node.type == "parenthesized_expression" and node.named_children:
        return _js_chain(node.named_children[0])
    if node.type == "non_null_expression" and node.named_children:  # TS `x!`
        return _js_chain(node.named_children[0])
    return None


def _py_chain(node: Node | None) -> str | None:
    if node is None:
        return None
    if node.type == "identifier":
        return _text(node)
    if node.type == "attribute":
        obj = _py_chain(node.child_by_field_name("object"))
        attr = node.child_by_field_name("attribute")
        return f"{obj}.{_text(attr)}" if obj is not None and attr is not None else None
    if node.type == "call" and _text(node.child_by_field_name("function")) == "super":
        return "super"
    return None


def _java_chain(node: Node | None) -> str | None:
    if node is None:
        return None
    if node.type in ("identifier", "this", "super"):
        return _text(node)
    if node.type == "field_access":
        obj = _java_chain(node.child_by_field_name("object"))
        field = node.child_by_field_name("field")
        return f"{obj}.{_text(field)}" if obj is not None and field is not None else None
    if node.type == "scoped_identifier":  # a.b.C in a static call
        return _text(node)
    return None


def _simple_type(node: Node | None) -> str | None:
    """A type written in a declaration, without type arguments."""
    if node is None:
        return None
    if node.type in ("type_annotation", "type") and node.named_children:
        return _simple_type(node.named_children[0])
    if node.type in ("generic_type", "subscript"):
        inner = node.child_by_field_name("name") or (
            node.named_children[0] if node.named_children else None)
        return _simple_type(inner)
    if node.type in ("type_identifier", "identifier", "scoped_type_identifier",
                     "nested_type_identifier", "attribute", "scoped_identifier"):
        return _text(node)
    return None


# --- per-language call and local recognizers -----------------------------------------

def _js_call(node: Node, guarded: bool) -> Call | None:
    if node.type == "call_expression":
        fn = node.child_by_field_name("function")
        args = node.child_by_field_name("arguments")
        optional = any(c.type == "optional_chain" for c in node.children)
        if fn is None or fn.type == "import" or (fn.type == "identifier" and _text(fn) in (
                "require", "super")):
            return None
        if fn.type == "identifier":
            return Call(None, _text(fn), _line(node), guarded or optional, _argc(args))
        if fn.type == "member_expression":
            prop = fn.child_by_field_name("property")
            optional = optional or any(c.type == "optional_chain" for c in fn.children)
            recv = _js_chain(fn.child_by_field_name("object"))
            return Call(recv if recv is not None else DYNAMIC, _text(prop), _line(node),
                        guarded or optional, _argc(args))
        return Call(DYNAMIC, "", _line(node), guarded, _argc(args))
    if node.type == "new_expression":
        ctor = node.child_by_field_name("constructor")
        args = node.child_by_field_name("arguments")
        name = _js_chain(ctor)
        if name is None:
            return Call(DYNAMIC, "", _line(node), guarded, _argc(args), new=True)
        recv, _, last = name.rpartition(".")
        return Call(recv or None, last, _line(node), guarded, _argc(args), new=True)
    return None


def _js_local(node: Node) -> Local | None:
    if node.type != "variable_declarator":
        return None
    name, value = node.child_by_field_name("name"), node.child_by_field_name("value")
    if name is None or name.type != "identifier":
        return None
    t = _simple_type(node.child_by_field_name("type"))
    if t:
        return Local(_text(name), t)
    if value is not None and value.type == "await_expression" and value.named_children:
        value = value.named_children[0]
    if value is not None and value.type == "new_expression":
        ctor = _js_chain(value.child_by_field_name("constructor"))
        if ctor:
            return Local(_text(name), ctor)
    return None


def _py_call(node: Node, guarded: bool) -> Call | None:
    if node.type != "call":
        return None
    fn = node.child_by_field_name("function")
    args = node.child_by_field_name("arguments")
    if fn is None:
        return None
    if fn.type == "identifier":
        if _text(fn) == "super":
            return None
        return Call(None, _text(fn), _line(node), guarded, _argc(args))
    if fn.type == "attribute":
        recv = _py_chain(fn.child_by_field_name("object"))
        attr = fn.child_by_field_name("attribute")
        return Call(recv if recv is not None else DYNAMIC, _text(attr), _line(node), guarded,
                    _argc(args))
    return Call(DYNAMIC, "", _line(node), guarded, _argc(args))


def _py_local(node: Node) -> Local | None:
    if node.type != "assignment":
        return None
    left = node.child_by_field_name("left")
    if left is None or left.type != "identifier":
        return None
    t = _simple_type(node.child_by_field_name("type"))
    if t:
        return Local(_text(left), t)
    right = node.child_by_field_name("right")
    if right is not None and right.type == "await" and right.named_children:
        right = right.named_children[0]
    if right is not None and right.type == "call":
        fn = right.child_by_field_name("function")
        if fn is not None and fn.type in ("identifier", "attribute"):
            return Local(_text(left), _text(fn), ctor=True)
    return None


def _java_call(node: Node, guarded: bool) -> Call | None:
    if node.type == "method_invocation":
        name = node.child_by_field_name("name")
        args = node.child_by_field_name("arguments")
        obj = node.child_by_field_name("object")
        if obj is None:
            return Call(None, _text(name), _line(node), guarded, _argc(args))
        recv = _java_chain(obj)
        return Call(recv if recv is not None else DYNAMIC, _text(name), _line(node), guarded,
                    _argc(args))
    if node.type == "object_creation_expression":
        t = _simple_type(node.child_by_field_name("type"))
        args = node.child_by_field_name("arguments")
        if t is None:
            return Call(DYNAMIC, "", _line(node), guarded, _argc(args), new=True)
        recv, _, last = t.rpartition(".")
        return Call(recv or None, last, _line(node), guarded, _argc(args), new=True)
    return None


def _java_local(node: Node) -> list[Local]:
    if node.type != "local_variable_declaration":
        return []
    t = _simple_type(node.child_by_field_name("type"))
    out = []
    for d in node.children_by_field_name("declarator"):
        name = d.child_by_field_name("name")
        value = d.child_by_field_name("value")
        typ = t
        if typ == "var":  # `var x = new T()` only
            typ = _simple_type(value.child_by_field_name("type")) \
                if value is not None and value.type == "object_creation_expression" else None
        if typ and name is not None:
            out.append(Local(_text(name), typ))
    return out


def collect_calls(lang: str, functions: list, nodes: list[Node]) -> None:
    """Fills `calls`, `locals`, `body` and the async flags on each function from its node
    (structure.py builds the statement tree and records the calls in evaluation order)."""
    from structure import build_function  # structure imports this module's recognizers

    recorded = {(n.start_byte, n.end_byte) for n in nodes}
    for fn, node in zip(functions, nodes):
        build_function(lang, fn, node, recorded)
