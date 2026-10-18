"""Every import form from repograph-spec.md §6, per language, through tree-sitter."""

from extract import JavaImport, PyImport, extract_imports


def js(src: str, path: str = "a.ts") -> list[str]:
    lang = "ts" if path.endswith(("ts", "tsx")) else "js"
    return extract_imports(path, lang, src).specifiers


def test_js_import_forms():
    src = """
import a from './a';
import { b, c as d } from "./b";
import * as e from './e';
import type { T } from './types';
import './side-effect';
export { x } from './x';
export * from './all';
const r = require('./req');
const lazy = () => import('./lazy');
"""
    assert js(src) == ["./a", "./b", "./e", "./types", "./side-effect", "./x", "./all",
                       "./req", "./lazy"]


def test_js_ignores_comments_strings_and_dynamic_specifiers():
    src = """
// import a from './commented';
/* const b = require('./block-commented'); */
const s = "import c from './in-a-string'";
const d = require(name);
const e = import(`./${name}`);
const f = notRequire('./nope');
export const g = 1;
"""
    assert js(src) == []


def test_js_jsx_and_commonjs_files():
    jsx = "import React from 'react';\nexport const A = () => <div>{require('./b')}</div>;\n"
    assert js(jsx, "a.jsx") == ["react", "./b"]
    assert js("module.exports = require('./c');\n", "a.cjs") == ["./c"]


def test_ts_and_tsx_grammars():
    # `<T>x` is a cast in .ts but JSX in .tsx; each must parse with its own grammar.
    assert js("import { a } from './a';\nconst x = <number>y;\n", "a.ts") == ["./a"]
    assert js("import { a } from './a';\nexport const C = () => <A b={1} />;\n",
              "a.tsx") == ["./a"]
    assert js("import fs = require('./fs');\n", "a.ts") == ["./fs"]


def test_js_duplicate_specifiers_collapse():
    assert js("import a from './a';\nimport { b } from './a';\n") == ["./a"]


def py(src: str) -> list[PyImport]:
    return extract_imports("m.py", "py", src).python


def test_python_import_forms():
    src = """
import os
import a.b.c, d.e as f
from x.y import z, w as v
from . import sibling
from .. import parent_mod
from ...pkg.mod import thing
from .mod import (one,
    two)
from star import *
# import commented
def f():
    import inner
"""
    assert py(src) == [
        PyImport(0, "os"),
        PyImport(0, "a.b.c"),
        PyImport(0, "d.e"),
        PyImport(0, "x.y", ("z", "w")),
        PyImport(1, "", ("sibling",)),
        PyImport(2, "", ("parent_mod",)),
        PyImport(3, "pkg.mod", ("thing",)),
        PyImport(1, "mod", ("one", "two")),
        PyImport(0, "star"),
        PyImport(0, "inner"),
    ]


def test_java_package_and_imports():
    src = """
package com.example.app;

import com.example.model.Order;
import static com.example.util.Strings.trim;
import com.example.jobs.*;
// import com.example.Commented;
import java.util.List;

public class A {}
"""
    imports = extract_imports("A.java", "java", src)
    assert imports.java_package == "com.example.app"
    assert imports.java == [
        JavaImport("com.example.model.Order"),
        JavaImport("com.example.util.Strings.trim"),
        JavaImport("com.example.jobs", wildcard=True),
        JavaImport("java.util.List"),
    ]


def test_java_default_package():
    assert extract_imports("A.java", "java", "class A {}").java_package is None


def test_broken_syntax_still_yields_what_parses():
    assert js("import a from './a';\nfunction (( {\n") == ["./a"]
