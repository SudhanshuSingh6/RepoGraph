import pytest

from filters import is_entry_point, is_test, keep_path, lang_of


@pytest.mark.parametrize("path,lang", [
    ("A.java", "java"), ("a.js", "js"), ("a.jsx", "js"), ("a.mjs", "js"), ("a.cjs", "js"),
    ("a.ts", "ts"), ("a.tsx", "ts"), ("a.mts", "ts"), ("a.cts", "ts"), ("a.py", "py"),
    ("a.go", None), ("Makefile", None), ("README.md", None),
])
def test_lang_of(path, lang):
    assert lang_of(path) == lang


@pytest.mark.parametrize("path", [
    "node_modules/x/index.js", "a/.git/hooks/x.py", "dist/app.js", "pkg/build/a.ts",
    "target/A.java", "src/__pycache__/m.py", ".venv/lib/x.py", "venv/x.py",
    "x/site-packages/y.py", ".svelte-kit/out.js", "coverage/lcov.js", ".next/a.js",
])
def test_ignored_dirs(path):
    assert not keep_path(path)


@pytest.mark.parametrize("path", [
    "types/a.d.ts", "a.d.mts", "a.d.cts", "vendor/jq.min.js", "a.min.mjs", "a.min.cjs",
    "app.bundle.js",
])
def test_excluded_files(path):
    assert not keep_path(path)


@pytest.mark.parametrize("path", ["src/a.ts", "app/models.py", "src/main/java/A.java",
                                  "lib/builder.js", "outline/a.js"])
def test_kept(path):
    assert keep_path(path)


@pytest.mark.parametrize("path", [
    "tests/a.py", "test/a.js", "src/__tests__/a.ts", "spec/a.ts", "specs/a.ts", "e2e/a.ts",
    "__mocks__/fs.js", "src/a.test.ts", "src/a.spec.js", "pkg/test_mod.py", "pkg/mod_test.py",
    "conftest.py", "app/src/test/java/A.java", "FooTest.java", "FooTests.java", "FooIT.java",
])
def test_is_test(path):
    assert is_test(path)


@pytest.mark.parametrize("path", ["src/a.ts", "contest.py", "testing.py", "src/latest/a.ts",
                                  "Testimony.java", "attest/a.js"])
def test_not_test(path):
    assert not is_test(path)


@pytest.mark.parametrize("path", ["src/index.ts", "main.py", "pkg/__init__.py", "__main__.py",
                                  "app.js", "wsgi.py", "manage.py", "setup.py",
                                  "src/DemoApplication.java", "Main.java"])
def test_entry_points(path):
    assert is_entry_point(path, "")


def test_python_main_guard_is_entry_point():
    assert is_entry_point("tools/run.py", 'if __name__ == "__main__":\n    run()')
    assert is_entry_point("tools/run.py", "if __name__ == '__main__': run()")
    assert not is_entry_point("tools/run.py", "def run(): ...")
    assert not is_entry_point("tools/run.js", 'if __name__ == "__main__":')
