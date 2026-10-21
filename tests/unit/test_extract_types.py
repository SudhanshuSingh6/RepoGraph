"""Class/interface declarations per language (repograph-spec.md §11), through tree-sitter."""

from pathlib import Path

from extract import TypeDecl, analyze_file

SAMPLE = Path(__file__).resolve().parents[2] / "fixtures" / "sample-project"


def types(src: str, path: str) -> list[tuple]:
    lang = {"java": "java", "py": "py", "js": "js"}.get(path.rsplit(".", 1)[1], "ts")
    return [(t.name, t.kind, t.extends, t.implements)
            for t in analyze_file(path, lang, src).types]


def test_java_kinds_supertypes_and_generics():
    src = """
package a.b;
// class Commented extends Nope {}
public abstract class Base<T> extends Parent<T> implements Runnable, java.io.Serializable {
    static class Inner extends Base<String> {}
}
interface Svc extends Closeable, a.Other {}
enum Color implements Named { RED }
record Point(int x, int y) implements Shape {}
final class Plain {}
"""
    assert types(src, "A.java") == [
        ("Base", "abstract", ("Parent",), ("Runnable", "java.io.Serializable")),
        ("Inner", "class", ("Base",), ()),
        ("Svc", "interface", ("Closeable", "a.Other"), ()),
        ("Color", "enum", (), ("Named",)),
        ("Point", "record", (), ("Shape",)),
        ("Plain", "class", (), ()),
    ]


def test_typescript_classes_interfaces_and_abstract():
    src = """
export abstract class Repo<T> extends Base<T> implements Store, ns.Closable {}
export class Mixed extends mixin(Base) {}
interface Props extends HTMLProps, ui.Themed<T> {}
const Anon = class extends Base {};
const s = "class InAString extends Nope {}";
"""
    assert types(src, "a.ts") == [
        ("Repo", "abstract", ("Base",), ("Store", "ns.Closable")),
        ("Mixed", "class", (), ()),  # a call expression isn't a resolvable name
        ("Props", "interface", ("HTMLProps", "ui.Themed"), ()),
    ]


def test_tsx_and_javascript():
    assert types("export class App extends React.Component { render() { return <div/>; } }",
                 "App.tsx") == [("App", "class", ("React.Component",), ())]
    assert types("class A extends B {}\nclass C {}", "a.js") == [
        ("A", "class", ("B",), ()),
        ("C", "class", (), ()),
    ]


def test_python_bases_drop_object_and_keywords():
    src = """
class A(Base, models.Model, Generic[T], metaclass=Meta):
    class Meta:
        pass
class B(object):
    pass
class C:
    pass
"""
    assert types(src, "m.py") == [
        ("A", "class", ("Base", "models.Model", "Generic"), ()),
        ("Meta", "class", (), ()),
        ("B", "class", (), ()),
        ("C", "class", (), ()),
    ]


def test_line_numbers_are_one_based():
    t = analyze_file("a.py", "py", "\n\nclass X:\n    pass\n").types
    assert t == [TypeDecl("X", "class", (), (), 3)]


def test_sample_project_base_job():
    def read(rel: str) -> list[tuple]:
        return types((SAMPLE / rel).read_text(), rel)

    jobs = "jobs/src/main/java/com/example/jobs/"
    assert read(jobs + "BaseJob.java") == [("BaseJob", "abstract", (), ())]
    assert read(jobs + "CleanupJob.java") == [("CleanupJob", "class", ("BaseJob",), ())]
