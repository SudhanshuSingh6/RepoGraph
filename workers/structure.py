"""Each recorded function's statement tree, for the APIs view's control-flow charts.

Syntax only. Every statement becomes a step (nothing is dropped), structures keep their
parts (conditions, branches, loop headers, catches, finally), and every call is recorded
once, in evaluation order: arguments before the call that receives them. Steps point to
calls by index into the function's `calls`, which flow_link.py resolves afterwards.

The meaning of the tree (which edge leaves which step, where break goes, what finally
does) is worked out in packages/analysis/apis/cfg.ts; this module only records what the
source says.
"""

from tree_sitter import Node

from calls import Call, Local, _java_call, _java_local, _js_call, _js_local, _py_call, _py_local
from queries import detect as detect_queries

TEXT_MAX = 400
STEP_MAX = 400

FUNCTION_VALUES = {
    # An object literal's method (`{ set(x) { … } }`) is a function value too; class
    # methods are recorded functions and are skipped before this applies.
    "js": ("arrow_function", "function_expression", "function", "generator_function",
           "method_definition"),
    "py": ("lambda",),
    "java": ("lambda_expression",),
}
# Definitions nested in a body: charted as one statement, their insides are their own.
NESTED_DEFS = {
    "js": ("function_declaration", "generator_function_declaration", "class_declaration",
           "class"),
    "py": ("function_definition", "class_definition", "decorated_definition"),
    "java": ("class_declaration", "local_class_declaration", "interface_declaration",
             "record_declaration", "enum_declaration", "class_body"),
}
CALL_TYPES = {"js": ("call_expression", "new_expression"), "py": ("call",),
              "java": ("method_invocation", "object_creation_expression")}
THEN = ("then", "catch", "finally")
TIMERS = ("setTimeout", "setInterval", "setImmediate", "queueMicrotask", "process.nextTick",
          "nextTick")
SHORT_CIRCUIT = ("&&", "||", "??", "and", "or")


def _text(node: Node | None) -> str:
    return node.text.decode("utf-8", errors="replace") if node is not None and node.text else ""


def squash(text: str) -> str:
    """Source text on one line, capped at TEXT_MAX with a … marker (`full_length` says
    how long it was)."""
    flat = " ".join(text.split())
    return flat if len(flat) <= TEXT_MAX else flat[: TEXT_MAX - 1] + "…"


def full_length(text: str) -> dict:
    """{"fullLength": n} when `squash` shortened the text, so the chart can say so."""
    n = len(" ".join(text.split()))
    return {"fullLength": n} if n > TEXT_MAX else {}


def _line(node: Node) -> int:
    return node.start_point[0] + 1


def _unwrap(node: Node | None) -> Node | None:
    """`(cond)` → `cond`."""
    while node is not None and node.type == "parenthesized_expression" and node.named_children:
        node = node.named_children[0]
    return node


def is_async(lang: str, node: Node) -> bool:
    if lang in ("js", "py"):
        return any(c.type == "async" for c in node.children)
    return False


def has_annotation(node: Node, name: str) -> bool:
    for c in node.children:
        if c.type == "modifiers":
            for a in c.named_children:
                if a.type in ("annotation", "marker_annotation") and \
                        _text(a.child_by_field_name("name")).rsplit(".", 1)[-1] == name:
                    return True
    return False


class Builder:
    def __init__(self, lang: str, recorded: set[tuple[int, int]], fn_node: Node):
        self.lang = lang
        self.recorded = recorded
        self.fn_node = fn_node
        self.calls: list[Call] = []
        self.nodes: list[Node] = []  # each call's node, for queries.detect
        self.locals: list[Local] = []
        self._seen_locals: set[str] = set()
        self.count = 0
        self.omitted = 0
        self.branch = 0  # > 0 inside a branch, loop body, case or catch: may not run
        self.call_of = {"js": _js_call, "py": _py_call, "java": _java_call}[lang]

    # --- expressions: calls in evaluation order ----------------------------------------

    def _skip(self, node: Node) -> bool:
        return node is not self.fn_node and (node.start_byte, node.end_byte) in self.recorded

    def _local(self, node: Node) -> None:
        if self.lang == "js":
            found = [x for x in (_js_local(node),) if x is not None]
        elif self.lang == "py":
            found = [x for x in (_py_local(node),) if x is not None]
        else:
            found = _java_local(node)
        for loc in found:
            if loc.name not in self._seen_locals:
                self._seen_locals.add(loc.name)
                self.locals.append(loc)

    def expr(self, node: Node | None, guarded: bool = False, when: dict | None = None,
             context: str | None = None) -> list[int]:
        """Records the calls in `node`, post-order, and returns their indexes."""
        if node is None or self._skip(node) or node.type in (
                "comment", "decorator", "annotation", "marker_annotation"):
            return []  # decorators run once, where the code is defined, not per call
        guarded = guarded or self.branch > 0
        self._local(node)
        t = node.type
        lang = self.lang
        if t in FUNCTION_VALUES[lang]:  # a callback: may run later, or never
            out: list[int] = []
            for c in node.named_children:
                out += self.expr(c, True, when, context or "callback")
            return out
        if t in NESTED_DEFS[lang]:
            return []
        if t in ("binary_expression", "boolean_operator"):
            op = _text(node.child_by_field_name("operator"))
            if op in SHORT_CIRCUIT:
                left, right = node.child_by_field_name("left"), node.child_by_field_name("right")
                out = self.expr(left, guarded, when, context)
                out += self.expr(right, True, {"op": op, "left": squash(_text(left))}, context)
                return out
        if t in ("ternary_expression", "conditional_expression"):
            if lang == "py":
                kids = node.named_children
                if len(kids) >= 3:
                    yes, cond, no = kids[0], kids[1], kids[-1]
                else:
                    return self._children(node, guarded, when, context)
            else:
                cond = node.child_by_field_name("condition")
                yes = node.child_by_field_name("consequence")
                no = node.child_by_field_name("alternative")
            ctext = squash(_text(_unwrap(cond)))
            out = self.expr(cond, guarded, when, context)
            out += self.expr(yes, True, {"op": "?", "left": ctext, "branch": True}, context)
            out += self.expr(no, True, {"op": "?", "left": ctext, "branch": False}, context)
            return out
        if t in ("await_expression", "await"):
            inner = node.named_children[0] if node.named_children else None
            out = self.expr(inner, guarded, when, context)
            inner = _unwrap(inner)
            if inner is not None and inner.type in CALL_TYPES[lang] and out:
                self.calls[out[-1]].awaited = True
            return out
        if t in ("list_comprehension", "set_comprehension", "dictionary_comprehension",
                 "generator_expression"):
            out, first = [], True
            for c in node.named_children:
                if c.type == "for_in_clause" and first:
                    first = False
                    out += self.expr(c.child_by_field_name("right"), guarded, when, context)
                    continue
                out += self.expr(c, True, when, context)
            return out
        if t in CALL_TYPES[lang]:
            return self._call(node, guarded, when, context)
        return self._children(node, guarded, when, context)

    def _children(self, node: Node, guarded: bool, when: dict | None,
                  context: str | None) -> list[int]:
        out: list[int] = []
        for c in node.named_children:
            out += self.expr(c, guarded, when, context)
        return out

    def _call(self, node: Node, guarded: bool, when: dict | None,
              context: str | None) -> list[int]:
        lang = self.lang
        out: list[int] = []
        if lang == "js":
            fn = node.child_by_field_name("function") or node.child_by_field_name("constructor")
            args = node.child_by_field_name("arguments")
            callee = _text(fn)
            prop = _text(fn.child_by_field_name("property")) if fn is not None and \
                fn.type == "member_expression" else ""
            if fn is not None and fn.type == "member_expression":
                out += self.expr(fn.child_by_field_name("object"), guarded, when, context)
            elif fn is not None and fn.type not in ("identifier", "import"):
                out += self.expr(fn, guarded, when, context)
            arg_ctx = "then" if prop in THEN else "timer" if callee in TIMERS or prop in (
                "nextTick",) else None
        elif lang == "py":
            fn = node.child_by_field_name("function")
            args = node.child_by_field_name("arguments")
            if fn is not None and fn.type == "attribute":
                out += self.expr(fn.child_by_field_name("object"), guarded, when, context)
            elif fn is not None and fn.type != "identifier":
                out += self.expr(fn, guarded, when, context)
            arg_ctx = None
        else:
            obj = node.child_by_field_name("object")
            out += self.expr(obj, guarded, when, context)
            args = node.child_by_field_name("arguments")  # an anonymous class body isn't walked
            arg_ctx = None
        for a in (args.named_children if args is not None else []):
            if a.type in FUNCTION_VALUES[lang]:
                out += self.expr(a, guarded, when, arg_ctx or context or "callback")
            else:
                out += self.expr(a, guarded, when, context)
        c = self.call_of(node, guarded)
        if c is None:
            return out
        if c.guarded and not guarded and when is None:
            # an optional call `a?.b()`
            obj = None
            fn = node.child_by_field_name("function")
            if fn is not None and fn.type == "member_expression":
                obj = fn.child_by_field_name("object")
            when = {"op": "?.", "left": squash(_text(obj if obj is not None else fn))}
        c.guarded = c.guarded or guarded
        c.when = when
        c.context = context
        self.calls.append(c)
        self.nodes.append(node)
        return out + [len(self.calls) - 1]

    def part(self, node: Node | None) -> dict | None:
        """A condition, header or value: its text and its calls."""
        if node is None:
            return None
        inner = _unwrap(node)
        return {"text": squash(_text(inner)), **full_length(_text(inner)),
                "calls": self.expr(node)}

    # --- statements --------------------------------------------------------------------

    def branch_body(self, node: Node | None) -> list[dict]:
        """A body that may not run whenever its parent does (a branch, a loop body, a
        case, a catch): calls in it are marked guarded."""
        self.branch += 1
        try:
            return self.body(node)
        finally:
            self.branch -= 1

    def branch_steps(self, nodes: list[Node]) -> list[dict]:
        self.branch += 1
        try:
            return [s for n in nodes for s in self.stmt(n)]
        finally:
            self.branch -= 1

    def body(self, node: Node | None) -> list[dict]:
        """The statements of a block (or a lone statement used as a body)."""
        if node is None:
            return []
        if node.type in ("statement_block", "block", "constructor_body", "switch_body"):
            out: list[dict] = []
            for c in node.named_children:
                out += self.stmt(c)
            return out
        if node.type == "else_clause" and self.lang == "js":
            return self.body(node.named_children[0] if node.named_children else None)
        return self.stmt(node)

    def stmt(self, node: Node) -> list[dict]:
        t = node.type
        if t in ("comment", "empty_statement", "line_comment", "block_comment"):
            return []
        if self.count >= STEP_MAX:
            self.omitted += 1
            return []
        self.count += 1
        line = _line(node)
        lang = self.lang
        if t in ("statement_block", "block") and node is not self.fn_node:
            return [{"kind": "block", "line": line, "label": None, "text": "{ … }",
                     "body": self.body(node)}]
        if t == "labeled_statement":
            label_node = node.child_by_field_name("label") or next(
                (c for c in node.named_children if c.type in ("identifier",
                                                              "statement_identifier")), None)
            inner = node.child_by_field_name("body") or next(
                (c for c in node.named_children if c is not label_node), None)
            self.count -= 1
            steps = self.stmt(inner) if inner is not None else []
            if steps:
                steps[0]["label"] = _text(label_node)
            return steps
        if t == "if_statement":
            return [self._if(node)]
        if t in ("for_statement", "for_in_statement", "enhanced_for_statement", "while_statement",
                 "do_statement"):
            return [self._loop(node)]
        if t in ("switch_statement", "switch_expression"):
            return [self._switch(node)]
        if t == "match_statement":
            return [self._match(node)]
        if t in ("try_statement", "try_with_resources_statement"):
            return [self._try(node)]
        if t == "with_statement":
            clause = next((c for c in node.named_children if c.type == "with_clause"), None)
            items = {"text": squash(_text(clause)), "calls": self.expr(clause)}
            return [{"kind": "with", "line": line, "items": items,
                     "body": self.body(node.child_by_field_name("body"))}]
        if t == "synchronized_statement":
            lock = next((c for c in node.named_children if c.type == "parenthesized_expression"),
                        None)
            return [{"kind": "block", "line": line, "label": None,
                     "text": f"synchronized {squash(_text(lock))}",
                     "calls": self.expr(lock), "body": self.body(node.child_by_field_name("body"))}]
        if t == "return_statement":
            value = node.named_children[0] if node.named_children else None
            return [{"kind": "return", "line": line, "text": squash(_text(node)),
                     **full_length(_text(node)),
                     "value": self.part(value)}]
        if t in ("throw_statement", "raise_statement"):
            value = node.named_children[0] if node.named_children else None
            return [{"kind": "throw", "line": line, "text": squash(_text(node)),
                     **full_length(_text(node)),
                     "value": self.part(value), "type": self._thrown_type(value)}]
        if t in ("break_statement", "continue_statement"):
            label = next((c for c in node.named_children if c.type in (
                "statement_identifier", "identifier")), None)
            return [{"kind": "break" if t == "break_statement" else "continue", "line": line,
                     "label": _text(label) if label is not None else None}]
        if t in NESTED_DEFS[lang] or (lang == "js" and t == "export_statement"):
            name = node.child_by_field_name("name")
            return [{"kind": "stmt", "line": line, "calls": [],
                     "text": squash(f"defines {_text(name) or t.replace('_', ' ')}")}]
        # Anything else is a plain statement: expression, declaration, assignment, …
        return [{"kind": "stmt", "line": line, "text": squash(_text(node)),
                 **full_length(_text(node)),
                 "calls": self.expr(node)}]

    def _thrown_type(self, value: Node | None) -> str | None:
        """`throw new X(…)` / `raise X(…)` / `raise X` → X. None when it isn't evident."""
        if value is None:
            return None
        if value.type in ("new_expression", "object_creation_expression"):
            t = value.child_by_field_name("constructor") or value.child_by_field_name("type")
            return _text(t).split("<", 1)[0] if t is not None else None
        if value.type == "call":
            return _text(value.child_by_field_name("function"))
        if self.lang == "py" and value.type in ("identifier", "attribute") and \
                _text(value)[:1].isupper():
            return _text(value)
        return None

    def _if(self, node: Node) -> dict:
        line = _line(node)
        if self.lang == "py":
            cond = self.part(node.child_by_field_name("condition"))
            then = self.branch_body(node.child_by_field_name("consequence"))
            alts = node.children_by_field_name("alternative")
            return {"kind": "if", "line": line, "cond": cond, "then": then,
                    "else": self._py_elif(alts)}
        cond = self.part(node.child_by_field_name("condition"))
        then = self.branch_body(node.child_by_field_name("consequence"))
        alt = node.child_by_field_name("alternative")
        return {"kind": "if", "line": line, "cond": cond, "then": then,
                "else": self.branch_body(alt) if alt is not None else None}

    def _py_elif(self, alts: list[Node]) -> list[dict] | None:
        if not alts:
            return None
        first, rest = alts[0], alts[1:]
        if first.type == "else_clause":
            return self.branch_body(first.child_by_field_name("body"))
        # elif: an if nested in the else branch (its condition only runs on that branch)
        self.count += 1
        self.branch += 1
        try:
            step = {"kind": "if", "line": _line(first),
                    "cond": self.part(first.child_by_field_name("condition")),
                    "then": self.body(first.child_by_field_name("consequence")),
                    "else": self._py_elif(rest)}
        finally:
            self.branch -= 1
        return [step]

    def _loop(self, node: Node) -> dict:
        t = node.type
        line = _line(node)
        base = {"kind": "loop", "line": line, "label": None, "cond": None, "init": None,
                "update": None, "item": None, "iterable": None, "orelse": None}
        if t == "while_statement":
            base.update(loop="while", cond=self.part(node.child_by_field_name("condition")))
        elif t == "do_statement":
            base.update(loop="do")
            body = self.body(node.child_by_field_name("body"))  # runs at least once
            base["cond"] = self.part(node.child_by_field_name("condition"))
            base["body"] = body
            return base
        elif t == "for_statement" and self.lang == "py":
            base.update(loop="foreach", item=squash(_text(node.child_by_field_name("left"))),
                        iterable=self.part(node.child_by_field_name("right")))
        elif t == "for_statement":
            init_node = node.child_by_field_name("initializer") or node.child_by_field_name("init")
            inits = []
            if init_node is not None:
                self.count += 1
                inits = [{"kind": "stmt", "line": _line(init_node),
                          "text": squash(_text(init_node)), "calls": self.expr(init_node)}]
            cond = node.child_by_field_name("condition")
            upd = node.child_by_field_name("increment") or node.child_by_field_name("update")
            base.update(loop="for", init=inits, cond=self.part(cond))
            body = self.branch_body(node.child_by_field_name("body"))
            self.branch += 1
            base["update"] = self.part(upd)  # evaluated after the body: recorded after it
            self.branch -= 1
            base["body"] = body
            return base
        elif t == "for_in_statement":
            base.update(loop="foreach", item=squash(_text(node.child_by_field_name("left"))),
                        iterable=self.part(node.child_by_field_name("right")))
        else:  # enhanced_for_statement
            base.update(loop="foreach", item=squash(_text(node.child_by_field_name("name"))),
                        iterable=self.part(node.child_by_field_name("value")))
        base["body"] = self.branch_body(node.child_by_field_name("body"))
        alt = node.child_by_field_name("alternative")
        if self.lang == "py" and alt is not None:
            base["orelse"] = self.branch_body(alt.child_by_field_name("body"))
        return base

    def _switch(self, node: Node) -> dict:
        line = _line(node)
        subject = self.part(node.child_by_field_name("value") or
                            node.child_by_field_name("condition"))
        body = node.child_by_field_name("body")
        cases: list[dict] = []
        arrow = False
        for c in (body.named_children if body is not None else []):
            if c.type == "switch_case":  # JS
                values = c.children_by_field_name("value")
                cases.append({"line": _line(c), "labels": [squash(_text(v)) for v in values],
                              "isDefault": False,
                              "body": self.branch_steps(c.children_by_field_name("body"))})
            elif c.type == "switch_default":
                cases.append({"line": _line(c), "labels": [], "isDefault": True,
                              "body": self.branch_steps(c.children_by_field_name("body"))})
            elif c.type in ("switch_block_statement_group", "switch_rule"):  # Java
                arrow = arrow or c.type == "switch_rule"
                labels = [x for x in c.named_children if x.type == "switch_label"]
                is_default = any(not x.named_children for x in labels)
                stmts = [x for x in c.named_children if x.type != "switch_label"]
                steps = self.branch_steps(stmts)
                cases.append({"line": _line(c), "isDefault": is_default,
                              "labels": [squash(_text(v)) for x in labels
                                         for v in x.named_children],
                              "body": steps})
        return {"kind": "switch", "line": line, "label": None, "subject": subject,
                "cases": cases, "arrow": arrow,
                "hasDefault": any(c["isDefault"] for c in cases)}

    def _match(self, node: Node) -> dict:
        """Python `match`: cases are tried in order, so it's a chain of decisions."""
        line = _line(node)
        subject = self.part(node.child_by_field_name("subject"))
        body = node.child_by_field_name("body")
        cases = []
        for c in (body.named_children if body is not None else []):
            if c.type != "case_clause":
                continue
            patterns = [p for p in c.named_children if p.type == "case_pattern"]
            label = " | ".join(squash(_text(p)) for p in patterns) or "_"
            guard = c.child_by_field_name("guard")
            self.branch += 1
            try:
                cases.append({"line": _line(c), "labels": [label],
                              "isDefault": label == "_" and guard is None,
                              "guard": self.part(guard.named_children[0]) if guard is not None
                              and guard.named_children else None,
                              "body": self.body(c.child_by_field_name("consequence"))})
            finally:
                self.branch -= 1
        return {"kind": "match", "line": line, "label": None, "subject": subject,
                "cases": cases, "hasDefault": any(c["isDefault"] for c in cases)}

    def _try(self, node: Node) -> dict:
        line = _line(node)
        resources = None
        res = node.child_by_field_name("resources")
        if res is not None:
            resources = {"text": squash(_text(res)), "calls": self.expr(res)}
        body = self.body(node.child_by_field_name("body"))
        catches = []
        orelse = None
        fin = None
        for c in node.named_children:
            if c.type == "catch_clause":
                if self.lang == "js":
                    param = c.child_by_field_name("parameter")
                    catches.append({"line": _line(c), "types": None,
                                    "name": _text(param) or None,
                                    "body": self.branch_body(c.child_by_field_name("body"))})
                else:
                    fp = next((x for x in c.named_children if x.type == "catch_formal_parameter"),
                              None)
                    ct = next((x for x in fp.named_children if x.type == "catch_type"),
                              None) if fp is not None else None
                    types = [_text(x) for x in ct.named_children] if ct is not None else []
                    catches.append({"line": _line(c), "types": types or None,
                                    "name": _text(fp.child_by_field_name("name"))
                                    if fp is not None else None,
                                    "body": self.branch_body(c.child_by_field_name("body"))})
            elif c.type in ("except_clause", "except_group_clause"):
                value = c.child_by_field_name("value")
                name = None
                if value is not None and value.type == "as_pattern":
                    alias = value.child_by_field_name("alias")
                    name = _text(alias) or None
                    value = value.named_children[0] if value.named_children else None
                if value is None:
                    types = None  # bare `except:`
                elif value.type == "tuple":
                    types = [_text(x) for x in value.named_children]
                else:
                    types = [_text(value)]
                block = next((x for x in c.named_children if x.type == "block"), None)
                catches.append({"line": _line(c), "types": types, "name": name,
                                "body": self.branch_body(block)})
            elif c.type == "else_clause" and self.lang == "py":
                orelse = self.branch_body(c.child_by_field_name("body"))
            elif c.type == "finally_clause":
                block = c.child_by_field_name("body") or next(
                    (x for x in c.named_children if x.type in ("block", "statement_block")), None)
                fin = self.body(block)
        return {"kind": "try", "line": line, "resources": resources, "body": body,
                "catches": catches, "orelse": orelse, "finally": fin}


def build_function(lang: str, fn, node: Node, recorded: set[tuple[int, int]]) -> None:
    """Fills `calls`, `locals`, `body` and the async flags of one recorded function."""
    b = Builder(lang, recorded, node)
    fn.is_async = is_async(lang, node)
    fn.spring_async = lang == "java" and has_annotation(node, "Async")
    if fn.abstract:
        return
    steps: list[dict] = []
    body = node.child_by_field_name("body")
    if lang == "js":
        params = node.child_by_field_name("parameters")
        if params is not None and body is not None:
            defaults = b.expr(params)
            if defaults:
                steps.append({"kind": "stmt", "line": _line(params),
                              "text": "default parameter values", "calls": defaults})
        if body is not None and body.type != "statement_block":
            # `(x) => expr`: the expression is the return value
            steps.append({"kind": "return", "line": _line(body), "text": squash(_text(body)),
                          "value": b.part(body)})
            body = None
    if body is not None:
        steps += b.body(body)
    if b.omitted:
        steps.append({"kind": "truncated", "omitted": b.omitted})
    detect_queries(lang, b.calls, b.nodes, node)
    fn.calls = b.calls
    fn.locals = b.locals
    fn.body = steps
