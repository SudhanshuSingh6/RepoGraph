"""Java import resolution (repograph-spec.md §6 `linkFiles`)."""

SRC = "src/main/java/com/acme"


def cls(pkg: str, name: str, body: str = "") -> tuple[str, str]:
    path = f"{SRC}/{pkg.replace('.', '/').removeprefix('com/acme').strip('/')}/{name}.java"
    return path.replace("//", "/"), f"package {pkg};\n{body}\nclass {name} {{}}\n"


def test_fully_qualified_import(edges):
    a, a_src = cls("com.acme.app", "App", "import com.acme.model.Order;")
    o, o_src = cls("com.acme.model", "Order")
    assert edges({a: a_src, o: o_src}) == {(a, o)}


def test_static_member_and_nested_class_by_shortening(edges):
    a, a_src = cls("com.acme.app", "App",
                   "import static com.acme.util.Strings.trim;\n"
                   "import com.acme.model.Order.Status;")
    s, s_src = cls("com.acme.util", "Strings")
    o, o_src = cls("com.acme.model", "Order")
    assert edges({a: a_src, s: s_src, o: o_src}) == {(a, s), (a, o)}


def test_static_wildcard_names_a_class(edges):
    a, a_src = cls("com.acme.app", "App", "import static com.acme.util.Strings.*;")
    s, s_src = cls("com.acme.util", "Strings")
    assert edges({a: a_src, s: s_src}) == {(a, s)}


def test_wildcard_expands_to_the_package(edges):
    a, a_src = cls("com.acme.app", "App", "import com.acme.model.*;")
    members = [cls("com.acme.model", n) for n in ("Customer", "Order", "Product")]
    other, other_src = cls("com.acme.other", "Elsewhere")
    files = {a: a_src, other: other_src, **dict(members)}
    assert edges(files) == {(a, p) for p, _ in members}


def test_wildcard_is_capped_at_eight(edges):
    a, a_src = cls("com.acme.app", "App", "import com.acme.big.*;")
    members = [cls("com.acme.big", f"C{i:02}") for i in range(12)]
    got = edges({a: a_src, **dict(members)})
    assert got == {(a, p) for p, _ in members[:8]}  # the first 8, in path order


def test_library_imports_produce_no_edge(edges):
    a, a_src = cls("com.acme.app", "App",
                   "import java.util.List;\nimport org.junit.jupiter.api.Test;\n"
                   "import javax.persistence.*;")
    b, b_src = cls("com.acme.app", "Other")
    assert edges({a: a_src, b: b_src}) == set()


def test_default_package_class(edges):
    files = {"Main.java": "import Util;\nclass Main {}", "Util.java": "class Util {}"}
    assert edges(files) == {("Main.java", "Util.java")}
