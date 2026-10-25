"""Each function's statement tree (structure.py): every statement kept, structures with
their parts, calls in evaluation order, async facts and the size caps."""

import structure


def fn(rows, path, name, owner=None):
    return next(f for f in rows[path]["functions"] if f["name"] == name and f["owner"] == owner)


def call_names(f, idxs):
    return [f["calls"][i]["name"] for i in idxs]


def kinds(steps):
    return [s["kind"] for s in steps]


def test_js_every_statement_and_structure(flows):
    rows, _ = flows({"a.js": """
async function f(x) {
  let y = 1;
  y += 2;
  if (check(a())) { one(); } else if (x) { two(); } else { three(); }
  outer: for (let i = 0; i < n(); i++) { if (x) continue outer; else break; }
  for (const k of items()) { use(k); }
  while (ok()) {}
  do { x++; } while (more());
  switch (v) { case 1: case 2: s1(); break; default: s2(); }
  try { await g(); } catch (e) { h(); } finally { z(); }
  return y;
}"""})
    f = fn(rows, "a.js", "f")
    body = f["body"]
    assert kinds(body) == ["stmt", "stmt", "if", "loop", "loop", "loop", "loop", "switch", "try",
                           "return"]
    assert body[0]["text"] == "let y = 1;" and body[0]["calls"] == []  # nothing dropped
    # calls in the condition, arguments first
    assert call_names(f, body[2]["cond"]["calls"]) == ["a", "check"]
    elif_ = body[2]["else"][0]
    assert elif_["kind"] == "if" and call_names(f, elif_["then"][0]["calls"]) == ["two"]
    loop = body[3]
    assert loop["loop"] == "for" and loop["label"] == "outer"
    assert loop["init"][0]["text"] == "let i = 0;" and call_names(f, loop["cond"]["calls"]) == ["n"]
    assert loop["update"]["text"] == "i++"
    assert loop["body"][0]["then"] == [{"kind": "continue", "line": 6, "label": "outer"}]
    assert loop["body"][0]["else"] == [{"kind": "break", "line": 6, "label": None}]
    assert body[4]["loop"] == "foreach" and body[4]["item"] == "k"
    assert call_names(f, body[4]["iterable"]["calls"]) == ["items"]
    assert body[5]["loop"] == "while" and body[6]["loop"] == "do"
    sw = body[7]
    assert [c["labels"] for c in sw["cases"]] == [["1"], ["2"], []]
    assert sw["cases"][0]["body"] == [] and sw["arrow"] is False and sw["hasDefault"]
    assert kinds(sw["cases"][1]["body"]) == ["stmt", "break"]
    t = body[8]
    assert t["catches"][0]["types"] is None and t["catches"][0]["name"] == "e"
    assert call_names(f, t["finally"][0]["calls"]) == ["z"]
    assert body[9]["value"]["text"] == "y"


def test_js_async_facts(flows):
    rows, _ = flows({"a.ts": """
export async function h(req) {
  await svc.load();
  svc.fire();
  promise.then(r => after(r));
  setTimeout(() => later(), 10);
  items.forEach(i => each(i));
}
export function plain() { go(); }
const arrow = async () => { await x(); };
"""})
    h = fn(rows, "a.ts", "h")
    assert h["is_async"] and not fn(rows, "a.ts", "plain")["is_async"]
    assert fn(rows, "a.ts", "arrow")["is_async"]
    by = {c["name"]: c for c in h["calls"]}
    assert by["load"]["awaited"] and not by["fire"]["awaited"]
    assert by["after"]["context"] == "then" and by["after"]["guarded"]
    assert by["later"]["context"] == "timer"
    assert by["each"]["context"] == "callback"
    assert by["then"]["context"] is None and not by["then"]["guarded"]


def test_short_circuit_ternary_and_optional_conditions(flows):
    rows, _ = flows({"a.js": "function f() { a() && b(); c() || d(); x ? e() : g(); o?.m(); }"})
    f = fn(rows, "a.js", "f")
    by = {c["name"]: c for c in f["calls"]}
    assert by["a"]["when"] is None
    assert by["b"]["when"] == {"op": "&&", "left": "a()"}
    assert by["d"]["when"] == {"op": "||", "left": "c()"}
    assert by["e"]["when"] == {"op": "?", "left": "x", "branch": True}
    assert by["g"]["when"] == {"op": "?", "left": "x", "branch": False}
    assert by["m"]["when"] == {"op": "?.", "left": "o"}


def test_post_order_calls(flows):
    rows, _ = flows({"a.js": "function f() { a(b(), c()); x.y().z(); }"})
    f = fn(rows, "a.js", "f")
    assert [c["name"] for c in f["calls"]] == ["b", "c", "a", "y", "z"]
    assert f["body"][0]["calls"] == [0, 1, 2] and f["body"][1]["calls"] == [3, 4]


def test_python_structures(flows):
    rows, _ = flows({"a.py": """
async def f(x):
    y = 1
    if a():
        b()
    elif c():
        pass
    else:
        d()
    for i in items():
        continue
    else:
        e()
    while ok():
        break
    try:
        await g()
    except (A, B) as ex:
        h()
    except:
        raise
    else:
        k()
    finally:
        z()
    with open(p) as fh:
        m()
    match v:
        case 1 | 2:
            one()
        case Point(x=0) if near():
            two()
        case _:
            three()
    raise NotFound("x")
"""})
    f = fn(rows, "a.py", "f")
    body = f["body"]
    assert f["is_async"]
    assert kinds(body) == ["stmt", "if", "loop", "loop", "try", "with", "match", "throw"]
    assert body[0]["text"] == "y = 1"
    elif_ = body[1]["else"][0]
    assert elif_["kind"] == "if" and call_names(f, elif_["cond"]["calls"]) == ["c"]
    assert elif_["then"] == [{"kind": "stmt", "line": 7, "text": "pass", "calls": []}]
    assert call_names(f, elif_["else"][0]["calls"]) == ["d"]
    assert body[2]["loop"] == "foreach" and body[2]["item"] == "i"
    assert call_names(f, body[2]["orelse"][0]["calls"]) == ["e"]
    t = body[4]
    assert [c["types"] for c in t["catches"]] == [["A", "B"], None]
    assert t["catches"][0]["name"] == "ex"
    assert t["catches"][1]["body"][0]["kind"] == "throw" and t["catches"][1]["body"][0]["value"] is None
    assert call_names(f, t["orelse"][0]["calls"]) == ["k"]
    assert call_names(f, t["finally"][0]["calls"]) == ["z"]
    assert call_names(f, body[5]["items"]["calls"]) == ["open"]
    m = body[6]
    assert [c["labels"] for c in m["cases"]] == [["1 | 2"], ["Point(x=0)"], ["_"]]
    assert call_names(f, m["cases"][1]["guard"]["calls"]) == ["near"]
    assert m["cases"][2]["isDefault"] and m["hasDefault"]
    assert body[7]["type"] == "NotFound"
    assert next(c for c in f["calls"] if c["name"] == "g")["awaited"]


def test_java_structures_and_async(flows):
    rows, _ = flows({"A.java": """
class A {
  @Async
  void f(int v) {
    switch (v) { case 1 -> one(); default -> { two(); } }
    try (var r = open()) { g(); } catch (A | B e) { h(); } catch (Exception e) { throw e; } finally { z(); }
    synchronized (this) { q(); }
    throw new NotFound("x");
  }
  void plain() { go(); }
}"""})
    f = fn(rows, "A.java", "f", "A")
    assert f["spring_async"] and not fn(rows, "A.java", "plain", "A")["spring_async"]
    body = f["body"]
    assert kinds(body) == ["switch", "try", "block", "throw"]
    assert body[0]["arrow"] and [c["isDefault"] for c in body[0]["cases"]] == [False, True]
    t = body[1]
    assert call_names(f, t["resources"]["calls"]) == ["open"]
    assert [c["types"] for c in t["catches"]] == [["A", "B"], ["Exception"]]
    assert body[2]["text"] == "synchronized (this)"
    assert body[3]["type"] == "NotFound"


def test_guarded_follows_the_structure(flows):
    rows, _ = flows({"a.py": """
def f(x):
    always()
    if x:
        branch()
    while cond():
        inloop()
    try:
        risky()
    except E:
        handle()
    finally:
        cleanup()
"""})
    g = {c["name"]: c["guarded"] for c in fn(rows, "a.py", "f")["calls"]}
    assert g == {"always": False, "branch": True, "cond": False, "inloop": True, "risky": False,
                 "handle": True, "cleanup": False}


def test_text_and_step_caps(flows):
    call_of = lambda n: "f(" + ", ".join(f"a{i:03d}" for i in range(n)) + ")"  # noqa: E731
    mid = call_of(55)  # ~350 chars: kept whole
    rows, _ = flows({"a.py": "def g():\n    " + mid + "\n"})
    step = fn(rows, "a.py", "g")["body"][0]
    assert step["text"] == mid and "fullLength" not in step
    big = call_of(80)  # ~500 chars: shortened, with its length kept
    rows, _ = flows({"a.py": "def g():\n    " + big + "\n"})
    step = fn(rows, "a.py", "g")["body"][0]
    assert len(step["text"]) == structure.TEXT_MAX and step["text"].endswith("…")
    assert step["fullLength"] == len(big)
    many = "def h():\n" + "".join(f"    x{i} = {i}\n" for i in range(structure.STEP_MAX + 7))
    rows, _ = flows({"b.py": many})
    body = fn(rows, "b.py", "h")["body"]
    assert len(body) == structure.STEP_MAX + 1
    assert body[-1] == {"kind": "truncated", "omitted": 7}


def test_thrown_type_chains_resolve_strictly(flows):
    rows, _ = flows({
        "src/p/E.java": "package p;\nclass NotFound extends AppError {}\n"
                        "class AppError extends RuntimeException {}\nclass Root {}\nclass Leaf extends Root {}",
        "src/p/S.java": "package p;\nclass S {\n  void f() { throw new NotFound(); }\n"
                        "  void g() { throw new IllegalStateException(); }\n"
                        "  void h() { throw new Leaf(); } }",
    })
    chains = {f["name"]: (f["body"][0]["typeChain"], f["body"][0]["chainComplete"])
              for f in rows["src/p/S.java"]["functions"]}
    assert chains["f"] == (["NotFound", "AppError", "RuntimeException"], False)  # leaves the repo
    assert chains["g"] == (["IllegalStateException"], False)
    assert chains["h"] == (["Leaf", "Root"], True)


def test_steps_keep_pointing_at_the_right_calls(flows):
    # `new Plain()` has no constructor to follow, but must keep its index.
    rows, _ = flows({"a.ts": "class Plain {}\nexport function f() { const p = new Plain(); after(p); }"})
    f = fn(rows, "a.ts", "f")
    assert [c["name"] for c in f["calls"]] == ["Plain", "after"]
    assert f["calls"][0]["noConstructor"] is True
    assert [f["calls"][i]["name"] for i in f["body"][1]["calls"]] == ["after"]


def test_object_literal_methods_are_callbacks(flows):
    rows, _ = flows({"a.ts": "export function make() { return { set(x) { render(x); } }; }"})
    f = fn(rows, "a.ts", "make")
    (c,) = f["calls"]
    assert c["name"] == "render" and c["context"] == "callback" and c["guarded"]


def test_parameter_decorators_are_not_calls(flows):
    rows, _ = flows({"a.ts": """
import { Controller, Get, Query } from '@nestjs/common';
@Controller('x')
export class XController {
  @Get() async list(@Query() q: any, p = fallback()) { return await this.svc.all(q); }
}"""})
    f = fn(rows, "a.ts", "list", "XController")
    assert [c["name"] for c in f["calls"]] == ["fallback", "all"]  # default value, then body
