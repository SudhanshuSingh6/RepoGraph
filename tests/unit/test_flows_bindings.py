"""Symbol-level imports (bindings) and exports, and the strict symbol lookup the APIs
view resolves through: never by name search, ambiguous means unresolved."""


def b(rows, path):
    return {x["local"]: (x["kind"], x["target"], x["name"]) for x in rows[path]["bindings"]}


def test_js_import_forms(flows):
    rows, _ = flows({
        "src/a.ts": "import def, { x as y, z } from './b';\nimport * as ns from './c';\n"
                    "import type { T } from './b';\nimport express from 'express';\n"
                    "const { p, q: r } = require('./c');\nconst m = require('./b');",
        "src/b.ts": "export default 1; export const x = 1, z = 2; export type T = number;",
        "src/c.js": "module.exports = { p: 1, q: 2 };",
    })
    got = b(rows, "src/a.ts")
    assert got["def"] == ("default", "src/b.ts", "default")
    assert got["y"] == ("named", "src/b.ts", "x")
    assert got["ns"] == ("namespace", "src/c.js", None)
    assert got["r"] == ("named", "src/c.js", "q")
    assert got["m"] == ("require", "src/b.ts", None)
    assert got["express"] == ("default", None, "default")  # a package: never traced
    assert next(x for x in rows["src/a.ts"]["bindings"] if x["local"] == "T")["typeOnly"]


def test_bare_specifier_is_a_package_even_if_a_repo_file_matches(flows):
    rows, _ = flows({"src/a.js": "import x from 'lodash';", "lodash.js": ""})
    assert b(rows, "src/a.js")["x"][1] is None


def test_js_exports(flows):
    rows, _ = flows({
        "src/a.js": "export function f() {}\nexport { g as h };\nfunction g() {}\n"
                    "export { k } from './b';\nexport * from './c';\nexport default f;",
        "src/b.js": "export const k = 1;", "src/c.js": "",
    })
    ex = rows["src/a.js"]["exports"]
    assert {"name": "f", "local": "f"} in ex
    assert {"name": "h", "local": "g"} in ex
    assert {"name": "default", "local": "f"} in ex
    assert {"name": "k", "local": None, "reexport": {"target": "src/b.js", "name": "k"}} in ex
    assert {"name": "*", "local": None, "reexport": {"target": "src/c.js", "name": "*"}} in ex


def test_same_name_in_two_files_follows_each_binding(flows):
    _, linker = flows({
        "src/a.js": "import { save } from './x';\nimport { save as persist } from './y';",
        "src/x.js": "export function save() {}",
        "src/y.js": "export function save() {}",
    })
    assert linker.resolve_ref(0, "save") == (1, "save")
    assert linker.resolve_ref(0, "persist") == (2, "save")


def test_non_exported_and_unbound_names_stay_unresolved(flows):
    _, linker = flows({
        "src/a.js": "import { hidden } from './x';\nimport { lib } from 'pkg';",
        "src/x.js": "function hidden() {}",
    })
    assert linker.resolve_ref(0, "hidden") is None  # not exported
    assert linker.resolve_ref(0, "lib") is None  # a package
    assert linker.resolve_ref(0, "nowhere") is None  # no binding at all


def test_export_star_collision_is_ambiguous(flows):
    _, linker = flows({
        "src/a.js": "import { f } from './idx';\nimport { g } from './idx';",
        "src/idx.js": "export * from './p';\nexport * from './q';",
        "src/p.js": "export function f() {}\nexport function g() {}",
        "src/q.js": "export function f() {}",
    })
    assert linker.resolve_ref(0, "f") is None
    assert linker.resolve_ref(0, "g") == (2, "g")


def test_reexport_chain(flows):
    _, linker = flows({
        "src/a.js": "import { f } from './idx';",
        "src/idx.js": "export { f } from './mid';",
        "src/mid.js": "export { inner as f } from './impl';",
        "src/impl.js": "export function inner() {}",
    })
    assert linker.resolve_ref(0, "f") == (3, "inner")


def test_python_bindings(flows):
    rows, linker = flows({
        "pkg/__init__.py": "",
        "pkg/views.py": "from . import helpers\nfrom .models import User as U\nimport os\n",
        "pkg/helpers.py": "def go(): pass",
        "pkg/models.py": "class User: pass",
    })
    got = b(rows, "pkg/views.py")
    assert got["helpers"] == ("module", "pkg/helpers.py", None)
    assert got["U"] == ("named", "pkg/models.py", "User")
    assert got["os"] == ("module", None, None)
    assert linker.resolve_ref(1, "helpers.go") == (2, "go")


def test_python_absolute_import_below_a_source_root(flows):
    rows, _ = flows({
        "backend/app/main.py": "from app.api import routes",
        "backend/app/api/routes.py": "",
    })
    assert b(rows, "backend/app/main.py")["routes"] == ("module", "backend/app/api/routes.py",
                                                          None)


def test_python_absolute_import_with_two_candidates_is_unresolved(flows):
    rows, _ = flows({
        "a/main.py": "from app.api import routes",
        "x/app/api/routes.py": "", "y/app/api/routes.py": "",
    })
    assert b(rows, "a/main.py")["routes"][1] is None


def test_python_all_narrows_exports(flows):
    rows, _ = flows({"m.py": "__all__ = ['a']\ndef a(): pass\ndef b(): pass"})
    assert [e["name"] for e in rows["m.py"]["exports"]] == ["a"]


def test_java_bindings(flows):
    rows, _ = flows({
        "src/a/A.java": "package a;\nimport b.B;\nimport static b.B.make;\nimport c.*;\n"
                        "import java.util.List;\nclass A {}",
        "src/b/B.java": "package b;\npublic class B { static B make() { return null; } }",
        "src/c/C.java": "package c;\nclass C {}",
    })
    got = b(rows, "src/a/A.java")
    assert got["B"] == ("named", "src/b/B.java", "B")
    assert got["make"] == ("static", "src/b/B.java", "B.make")
    assert got["*"] == ("package", "c", None)
    assert got["List"][1] is None
    assert rows["src/a/A.java"]["package"] == "a"


def test_functions_members_and_params(flows):
    rows, _ = flows({
        "S.java": "class S { private final Repo repo; S(Repo r) {}\n"
                  "  public static int go(int a, List<String> b) { return 0; } }",
        "s.ts": "export class Svc { constructor(private readonly repo: Repo, x: number) {}\n"
                "  async find(id: string) {} }\nexport const h = (a) => a;",
        "s.py": "class V:\n    n: int = 1\n    def __init__(self):\n        self.repo = Repo()\n"
                "def outer():\n    def inner(): pass",
    })
    java = rows["S.java"]
    assert {"owner": "S", "name": "repo", "type": "Repo"} in java["members"]
    go = next(f for f in java["functions"] if f["name"] == "go")
    assert go["static"] and go["params"] == [{"name": "a", "type": None},
                                             {"name": "b", "type": "List"}]
    ts = rows["s.ts"]
    assert {"owner": "Svc", "name": "repo", "type": "Repo"} in ts["members"]
    assert not any(m["name"] == "x" for m in ts["members"])  # not a parameter property
    assert [f["name"] for f in ts["functions"]] == ["constructor", "find", "h"]
    py = rows["s.py"]
    assert {"owner": "V", "name": "repo", "type": "Repo"} in py["members"]
    assert {"owner": "V", "name": "n", "type": "int"} in py["members"]
    inner = next(f for f in py["functions"] if f["name"] == "inner")
    assert inner["scope"] == "outer" and inner["owner"] is None
