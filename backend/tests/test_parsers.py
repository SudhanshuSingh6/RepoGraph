from app.parser.java_parser import JavaParser
from app.parser.js_ts_parser import JavaScriptParser
from app.parser.python_parser import PythonParser


def write(tmp_path, rel, content):
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return p


def by_type(result, node_type):
    return [n for n in result.nodes if n.type == node_type]


class TestPythonParser:
    def test_class_method_extraction(self, tmp_path):
        src = write(
            tmp_path,
            "svc.py",
            "class UserService:\n"
            "    def find(self, uid):\n"
            "        if uid:\n"
            "            return uid\n"
            "        return None\n",
        )
        result = PythonParser().parse_file(src, tmp_path, "r1")
        assert [n.name for n in by_type(result, "Class")] == ["UserService"]
        methods = by_type(result, "Method")
        assert [m.name for m in methods] == ["find"]
        # 1 base + 1 if = 2
        assert methods[0].properties["complexity"] == 2

    def test_rest_endpoint_with_methods_kwarg(self, tmp_path):
        src = write(
            tmp_path,
            "app.py",
            "@app.route('/login', methods=['POST'])\ndef login():\n    return 'ok'\n",
        )
        result = PythonParser().parse_file(src, tmp_path, "r1")
        eps = by_type(result, "RestEndpoint")
        assert len(eps) == 1
        assert eps[0].properties["http_method"] == "POST"
        assert eps[0].properties["path"] == "/login"

    def test_rest_endpoint_verb_decorator(self, tmp_path):
        src = write(tmp_path, "api.py", "@router.get('/users')\ndef users():\n    return []\n")
        result = PythonParser().parse_file(src, tmp_path, "r1")
        eps = by_type(result, "RestEndpoint")
        assert len(eps) == 1
        assert eps[0].properties["http_method"] == "GET"

    def test_extends_captured(self, tmp_path):
        src = write(tmp_path, "m.py", "class Child(Base):\n    pass\n")
        result = PythonParser().parse_file(src, tmp_path, "r1")
        assert any(r.parent_name == "Base" for r in result.inheritance_refs)

    def test_import_refs(self, tmp_path):
        src = write(tmp_path, "m.py", "from pkg.utils import helper\nimport os\n")
        result = PythonParser().parse_file(src, tmp_path, "r1")
        modules = [r.from_module or r.module_path for r in result.import_refs]
        assert "pkg.utils" in modules
        assert "os" in modules


class TestJsParser:
    def test_class_and_function(self, tmp_path):
        src = write(
            tmp_path,
            "svc.js",
            "class OrderService {\n  process(order) {\n    if (order) return 1;\n  }\n}\n"
            "function helper() { return 2; }\n",
        )
        result = JavaScriptParser().parse_file(src, tmp_path, "r1")
        assert [n.name for n in by_type(result, "Class")] == ["OrderService"]
        names = [n.name for n in by_type(result, "Method")]
        assert "process" in names
        assert "helper" in names

    def test_typescript_file(self, tmp_path):
        src = write(tmp_path, "a.ts", "export function fmt(x: number): string { return `${x}`; }\n")
        result = JavaScriptParser().parse_file(src, tmp_path, "r1")
        assert "fmt" in [n.name for n in by_type(result, "Method")]


class TestJavaParser:
    def test_class_interface_method(self, tmp_path):
        src = write(
            tmp_path,
            "Svc.java",
            "public interface Repo {}\n"
            "public class Svc implements Repo {\n"
            "    public int get(int id) {\n"
            "        if (id > 0) { return id; }\n"
            "        return 0;\n"
            "    }\n"
            "}\n",
        )
        result = JavaParser().parse_file(src, tmp_path, "r1")
        assert "Svc" in [n.name for n in by_type(result, "Class")]
        assert "Repo" in [n.name for n in by_type(result, "Interface")]
        assert "get" in [n.name for n in by_type(result, "Method")]
        assert any(
            r.parent_name == "Repo" and r.ref_type == "IMPLEMENTS" for r in result.inheritance_refs
        )
