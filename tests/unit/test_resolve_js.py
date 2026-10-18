"""JS/TS specifier resolution (repograph-spec.md §6 `linkFiles`)."""


def test_relative_with_and_without_extension(edges):
    files = {
        "src/a.ts": "import b from './b';\nimport c from './c.js';\nimport d from '../lib/d';",
        "src/b.ts": "",
        "src/c.js": "",
        "lib/d.tsx": "",
    }
    assert edges(files) == {("src/a.ts", "src/b.ts"), ("src/a.ts", "src/c.js"),
                            ("src/a.ts", "lib/d.tsx")}


def test_index_fallback(edges):
    files = {
        "src/app.js": "const u = require('./utils');\nimport w from './widgets/';",
        "src/utils/index.ts": "",
        "src/widgets/index.jsx": "",
    }
    assert edges(files) == {("src/app.js", "src/utils/index.ts"),
                            ("src/app.js", "src/widgets/index.jsx")}


def test_parent_and_cross_language_js_ts(edges):
    files = {
        "a/b/c.mjs": "export * from '../../root';",
        "root.cts": "",
    }
    assert edges(files) == {("a/b/c.mjs", "root.cts")}


def test_relative_specifier_escaping_the_repo_is_dropped(edges):
    assert edges({"a.ts": "import x from '../outside';", "outside.ts": ""}) == set()


def test_aliases_and_bare_paths_by_suffix(edges):
    files = {
        "app/src/main.ts": ("import a from '@/lib/api';\n"
                            "import b from '~/lib/store';\n"
                            "import c from 'src/components/button';\n"
                            "import d from 'lib/hooks';"),
        "app/src/lib/api.ts": "",
        "app/src/lib/store.js": "",
        "app/src/components/button.tsx": "",
        "app/src/lib/hooks/index.ts": "",
    }
    assert edges(files) == {
        ("app/src/main.ts", "app/src/lib/api.ts"),
        ("app/src/main.ts", "app/src/lib/store.js"),
        ("app/src/main.ts", "app/src/components/button.tsx"),
        ("app/src/main.ts", "app/src/lib/hooks/index.ts"),
    }


def test_bare_specifier_prefers_longest_shared_prefix(edges):
    files = {
        "packages/web/src/page.ts": "import c from '@/config';",
        "packages/api/src/config.ts": "",
        "packages/web/src/config.ts": "",
        "config.ts": "",
    }
    assert edges(files) == {("packages/web/src/page.ts", "packages/web/src/config.ts")}


def test_external_packages_produce_no_edge(edges):
    files = {
        "src/a.ts": ("import React from 'react';\nimport fp from 'lodash/fp';\n"
                     "import x from '@scope/pkg';\nimport fs from 'node:fs';"),
        "src/b.ts": "",
    }
    assert edges(files) == set()


def test_self_imports_and_duplicates(edges):
    files = {
        "a.ts": "import a from './a';\nimport b from './b';\nconst b2 = require('./b.ts');",
        "b.ts": "",
    }
    assert edges(files) == {("a.ts", "b.ts")}


def test_js_never_resolves_to_other_languages(edges):
    assert edges({"a.js": "import x from './x';", "x.py": ""}) == set()
