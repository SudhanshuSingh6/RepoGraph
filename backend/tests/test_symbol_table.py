from app.parser.base import ImportRef, NodeData
from app.parser.symbol_table import SymbolTable


def make_tree(tmp_path, files):
    for rel in files:
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("")
    return tmp_path


def ref(module_path="", from_module="", names=(), relative=False):
    return ImportRef(
        file_node_id="f1",
        module_path=module_path,
        from_module=from_module,
        imported_names=list(names),
        is_relative=relative,
    )


class TestPythonImports:
    def test_absolute_module(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["pkg/utils.py", "pkg/__init__.py"]))
        assert st.resolve_python_import("main.py", ref(module_path="pkg.utils")) == "pkg/utils.py"

    def test_absolute_package_init(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["pkg/__init__.py"]))
        assert st.resolve_python_import("main.py", ref(module_path="pkg")) == "pkg/__init__.py"

    def test_relative_sibling(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["pkg/a.py", "pkg/b.py"]))
        r = ref(from_module=".b", names=["thing"], relative=True)
        assert st.resolve_python_import("pkg/a.py", r) == "pkg/b.py"

    def test_relative_parent(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["pkg/sub/a.py", "pkg/c.py"]))
        r = ref(from_module="..c", names=["x"], relative=True)
        assert st.resolve_python_import("pkg/sub/a.py", r) == "pkg/c.py"

    def test_from_dot_import_name(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["pkg/a.py", "pkg/helpers.py"]))
        r = ref(from_module=".", names=["helpers"], relative=True)
        assert st.resolve_python_import("pkg/a.py", r) == "pkg/helpers.py"

    def test_unresolvable_returns_none(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["main.py"]))
        assert st.resolve_python_import("main.py", ref(module_path="requests")) is None


class TestJsImports:
    def test_relative_ts(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["src/app.ts", "src/api/client.ts"]))
        assert st.resolve_js_import("src/app.ts", "./api/client") == "src/api/client.ts"

    def test_relative_tsx_fallback(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["src/App.tsx", "src/components/Button.tsx"]))
        assert (
            st.resolve_js_import("src/App.tsx", "./components/Button")
            == "src/components/Button.tsx"
        )

    def test_index_resolution(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["src/app.js", "src/utils/index.js"]))
        assert st.resolve_js_import("src/app.js", "./utils") == "src/utils/index.js"

    def test_external_package_none(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["src/app.js"]))
        assert st.resolve_js_import("src/app.js", "react") is None


class TestJavaImports:
    def test_direct_fqn(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["com/example/Service.java"]))
        assert st.resolve_java_import("com.example.Service") == "com/example/Service.java"

    def test_nested_source_root(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["src/main/java/com/example/Repo.java"]))
        assert st.resolve_java_import("com.example.Repo") == "src/main/java/com/example/Repo.java"

    def test_unresolvable_none(self, tmp_path):
        st = SymbolTable(make_tree(tmp_path, ["Main.java"]))
        assert st.resolve_java_import("org.springframework.boot.SpringApplication") is None


class TestNameResolution:
    def test_prefer_type(self, tmp_path):
        st = SymbolTable(tmp_path)
        method = NodeData(id="1", type="Method", name="run", repo_id="r", file_path="a.py")
        cls = NodeData(id="2", type="Class", name="run", repo_id="r", file_path="b.py")
        st.add(method)
        st.add(cls)
        assert st.resolve_by_name("run", prefer_type="Method")[0].id == "1"
        assert st.resolve_by_name("run", prefer_type="Class")[0].id == "2"

    def test_file_lookup(self, tmp_path):
        st = SymbolTable(tmp_path)
        f = NodeData(id="3", type="File", name="a.py", repo_id="r", file_path="pkg/a.py")
        st.add(f)
        assert st.get_file("pkg/a.py").id == "3"
        assert st.get_file("missing.py") is None
