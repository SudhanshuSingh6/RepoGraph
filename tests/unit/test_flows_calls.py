"""Calls inside functions (receivers, guards, locals) and their strict resolution: a
call reaches a function only through bindings, exports or declared types, and is
otherwise left untraced with its reason, never matched by name."""


def fn(rows, path, name, owner=None):
    return next(f for f in rows[path]["functions"] if f["name"] == name and f["owner"] == owner)


def calls(rows, path, name, owner=None):
    """[(receiver.name, outcome)] where outcome is 'path#fn-name', a fanout/impls tuple,
    or the untraced reason."""
    out = []
    for c in fn(rows, path, name, owner)["calls"]:
        label = f"{c['receiver']}.{c['name']}" if c["receiver"] else c["name"]
        if "target" in c:
            t = c["target"]
            target_fn = rows[t["path"]]["functions"][t["fn"]]
            res = f"{t['path']}#{target_fn['owner'] + '.' if target_fn['owner'] else ''}{target_fn['name']}"
        elif "fanout" in c:
            res = ("fanout", sorted(x["path"] for x in c["fanout"]))
        elif "implementations" in c:
            res = ("implementations", c["implementations"]["type"], c["implementations"]["count"])
        elif c.get("noConstructor"):
            continue  # a class without its own constructor: nothing to follow
        else:
            res = c["untraced"]
        out.append((label, res))
    return out


def guarded(rows, path, name, owner=None):
    return {c["name"]: c["guarded"] for c in fn(rows, path, name, owner)["calls"]}


# --- extraction ----------------------------------------------------------------------

def test_js_guards_callbacks_and_dynamic(flows):
    rows, _ = flows({"a.js": """
function f(x) {
  always();
  if (x) { inIf(); } else { inElse(); }
  const y = x ? inTernary() : other();
  items.forEach(i => inCallback(i));
  x && rightOfAnd();
  maybe?.optional();
  for (const i of list()) { inLoop(); }
  try { inTry(); } catch (e) { inCatch(); } finally { inFinally(); }
  switch (x) { case 1: inCase(); }
  getRepo().find();
  obj[key]();
}"""})
    g = guarded(rows, "a.js", "f")
    assert {k for k, v in g.items() if not v} == {"always", "forEach", "list", "inTry",
                                                   "inFinally", "getRepo", "find", ""}
    assert all(g[k] for k in ("inIf", "inElse", "inTernary", "other", "inCallback",
                              "rightOfAnd", "optional", "inLoop", "inCatch", "inCase"))
    dyn = {c["name"]: c["untraced"] for c in fn(rows, "a.js", "f")["calls"]
           if c["receiver"] == "<expr>"}
    assert dyn == {"find": "dynamic", "": "dynamic"}


def test_python_guards_and_decorators_are_not_calls(flows):
    rows, _ = flows({"a.py": """
@decorate(setup())
def f(x, y=default()):
    always()
    if x:
        branch()
    elif y:
        other()
    [comp(i) for i in data()]
    a or right()
    v = t() if x else u()
    try:
        risky()
    except E:
        handle()
"""})
    g = guarded(rows, "a.py", "f")
    assert "setup" not in g and "decorate" not in g and "default" not in g
    assert not g["always"] and not g["data"] and not g["risky"]
    assert all(g[k] for k in ("branch", "other", "comp", "right", "t", "u", "handle"))


def test_calls_belong_to_the_innermost_recorded_function(flows):
    rows, _ = flows({"a.py": "def outer():\n    a()\n    def inner():\n        b()\n    inner()"})
    assert [c["name"] for c in fn(rows, "a.py", "outer")["calls"]] == ["a", "inner"]
    assert [c["name"] for c in fn(rows, "a.py", "inner")["calls"]] == ["b"]
    assert calls(rows, "a.py", "outer")[1] == ("inner", "a.py#inner")


def test_abstract_methods_have_no_calls(flows):
    rows, _ = flows({
        "R.java": "interface R { Owner find(int id); }",
        "s.ts": "interface S { go(): void }\nabstract class A { abstract run(): void }",
    })
    assert fn(rows, "R.java", "find", "R")["abstract"]
    assert fn(rows, "s.ts", "go", "S")["abstract"] and fn(rows, "s.ts", "run", "A")["abstract"]


# --- resolution: bindings and exports ------------------------------------------------

def test_same_name_in_two_files_follows_each_binding(flows):
    rows, _ = flows({
        "a.js": "import { save } from './x';\nimport { save as persist } from './y';\n"
                "export function f() { save(); persist(); }",
        "x.js": "export function save() {}",
        "y.js": "export function save() {}",
    })
    assert calls(rows, "a.js", "f") == [("save", "x.js#save"), ("persist", "y.js#save")]


def test_unresolvable_calls_carry_their_reason(flows):
    rows, _ = flows({
        "a.js": "import { hidden } from './x';\nimport { lib } from 'pkg';\n"
                "import * as ns from './x';\nimport { f, g } from './idx';\n"
                "export function run(req) { hidden(); lib(); nowhere(); console.log(1);\n"
                "  req.json(); ns.shown(); ns.missing(); f(); g(); }",
        "x.js": "function hidden() {}\nexport function shown() {}",
        "idx.js": "export * from './p';\nexport * from './q';",
        "p.js": "export function f() {}\nexport function g() {}",
        "q.js": "export function f() {}",
    })
    assert calls(rows, "a.js", "run") == [
        ("hidden", "not_found"),  # not exported
        ("lib", "library"),
        ("nowhere", "global"),
        ("console.log", "global"),
        ("req.json", "untyped"),
        ("ns.shown", "x.js#shown"),
        ("ns.missing", "not_found"),
        ("f", "ambiguous"),  # export * collision
        ("g", "p.js#g"),
    ]


def test_commonjs_require_and_default_objects(flows):
    rows, _ = flows({
        "a.js": "const ctrl = require('./ctrl');\nconst db = require('./db');\n"
                "function h() { ctrl.list(); db.user.find(); }",
        "ctrl.js": "module.exports = { list: () => 1 };",
        "db.js": "const client = make();\nmodule.exports = client;",
    })
    assert calls(rows, "a.js", "h") == [("ctrl.list", "ctrl.js#list"),
                                         ("db.user.find", "untyped")]


def test_python_modules_and_constructors(flows):
    rows, _ = flows({
        "app/__init__.py": "",
        "app/views.py": "from . import crud\nfrom .models import User\nimport app.util\n"
                        "def view():\n    crud.make()\n    u = User()\n    u.save()\n"
                        "    app.util.helper()\n    print(1)",
        "app/crud.py": "def make(): pass",
        "app/models.py": "class User:\n    def __init__(self): pass\n    def save(self): pass",
        "app/util.py": "def helper(): pass",
    })
    assert calls(rows, "app/views.py", "view") == [
        ("crud.make", "app/crud.py#make"),
        ("User", "app/models.py#User.__init__"),
        ("u.save", "app/models.py#User.save"),
        ("app.util.helper", "app/util.py#helper"),
        ("print", "global"),
    ]


# --- resolution: types, members, inheritance, dispatch -------------------------------

def test_java_members_inheritance_and_packages(flows):
    rows, _ = flows({
        "src/a/Ctl.java": """package a;
import b.Svc;
import c.*;
import d.*;
class Ctl extends Base {
  private final Svc svc;
  String show(Repo repo, Clash x) {
    svc.go();
    repo.find(1);
    helper();
    inherited();
    x.run();
    Util.now();
    new Svc();
    return null;
  }
  void helper() {}
}""",
        "src/a/Base.java": "package a;\nclass Base { void inherited() {} }",
        "src/a/Util.java": "package a;\nclass Util { static void now() {} }",
        "src/a/Repo.java": "package a;\nclass Repo { Object find(int id) { return null; } }",
        "src/b/Svc.java": "package b;\npublic class Svc { public Svc() {}\n void go() {} }",
        "src/c/Clash.java": "package c;\npublic class Clash { void run() {} }",
        "src/d/Clash.java": "package d;\npublic class Clash { void run() {} }",
    })
    assert calls(rows, "src/a/Ctl.java", "show", "Ctl") == [
        ("svc.go", "src/b/Svc.java#Svc.go"),  # implicit field, imported type
        ("repo.find", "src/a/Repo.java#Repo.find"),  # parameter, same-package type
        ("helper", "src/a/Ctl.java#Ctl.helper"),  # implicit this
        ("inherited", "src/a/Base.java#Base.inherited"),
        ("x.run", "ambiguous"),  # Clash is in both wildcard packages
        ("Util.now", "src/a/Util.java#Util.now"),
        ("Svc", "src/b/Svc.java#Svc.Svc"),  # constructor
    ]


def test_interface_dispatch(flows):
    def repo(n: int) -> dict[str, str]:
        files = {
            "src/p/Ctl.java": "package p;\nclass Ctl { private Port port;\n"
                              "  void run() { port.send(); } }",
            "src/p/Port.java": "package p;\ninterface Port { void send(); }",
        }
        for k in range(n):
            files[f"src/p/Impl{k}.java"] = (f"package p;\nclass Impl{k} implements Port "
                                             f"{{ public void send() {{}} }}")
        return files

    rows, _ = flows(repo(0))
    assert calls(rows, "src/p/Ctl.java", "run", "Ctl") == [("port.send", "src/p/Port.java#Port.send")]
    rows, _ = flows(repo(2))
    assert calls(rows, "src/p/Ctl.java", "run", "Ctl") == [
        ("port.send", ("fanout", ["src/p/Impl0.java", "src/p/Impl1.java"]))]
    rows, _ = flows(repo(4))
    assert calls(rows, "src/p/Ctl.java", "run", "Ctl") == [
        ("port.send", ("implementations", "Port", 4))]


def test_library_supertype_and_overloads(flows):
    rows, _ = flows({
        "src/p/OwnerRepository.java": "package p;\nimport org.springframework.data.jpa."
                                      "repository.JpaRepository;\n"
                                      "interface OwnerRepository extends JpaRepository<Owner, "
                                      "Integer> { Owner findByName(String n); }",
        "src/p/Owner.java": "package p;\nclass Owner { Pet getPet(String n) { return null; }\n"
                            "  Pet getPet(Integer id) { return null; }\n"
                            "  Pet getPet(String n, boolean b) { return null; } }",
        "src/p/Ctl.java": "package p;\nclass Ctl { private OwnerRepository owners;\n"
                          "  void run(Owner o) { owners.findByName(\"x\"); owners.save(o);\n"
                          "    o.getPet(\"a\"); o.getPet(\"a\", true); } }",
    })
    assert calls(rows, "src/p/Ctl.java", "run", "Ctl") == [
        ("owners.findByName", "src/p/OwnerRepository.java#OwnerRepository.findByName"),
        ("owners.save", "library"),  # inherited from JpaRepository
        ("o.getPet", "ambiguous"),  # two one-argument overloads
        ("o.getPet", "src/p/Owner.java#Owner.getPet"),
    ]


def test_nest_injected_member_and_python_self_member(flows):
    rows, _ = flows({
        "src/a.controller.ts": "import { ASvc } from './a.service';\n"
                               "export class ACtl { constructor(private readonly svc: ASvc) {}\n"
                               "  list() { return this.svc.all(); } }",
        "src/a.service.ts": "export class ASvc { all() { return this.helper(); }\n"
                            "  private helper() { return 1; } }",
        "v.py": "from repo import Repo\nclass V:\n    def __init__(self):\n"
                "        self.repo = Repo()\n    def get(self):\n        self.repo.load()",
        "repo.py": "class Repo:\n    def load(self): pass",
    })
    assert calls(rows, "src/a.controller.ts", "list", "ACtl") == [
        ("this.svc.all", "src/a.service.ts#ASvc.all")]
    assert calls(rows, "src/a.service.ts", "all", "ASvc") == [
        ("this.helper", "src/a.service.ts#ASvc.helper")]
    assert calls(rows, "v.py", "get", "V") == [("self.repo.load", "repo.py#Repo.load")]


def test_python_ctor_local_only_counts_for_classes(flows):
    rows, _ = flows({
        "a.py": "from m import make, Thing\ndef f():\n    x = make()\n    x.go()\n"
                "    t = Thing()\n    t.go()",
        "m.py": "def make(): pass\nclass Thing:\n    def go(self): pass",
    })
    assert calls(rows, "a.py", "f") == [
        ("make", "m.py#make"),
        ("x.go", "untyped"),  # make() isn't a class, so x has no known type
        ("t.go", "m.py#Thing.go"),  # Thing() has no __init__: no constructor node
    ]
