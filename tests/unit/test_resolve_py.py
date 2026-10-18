"""Python import resolution (repograph-spec.md §6 `linkFiles`)."""


def test_relative_dot_depths(edges):
    files = {
        "pkg/sub/deep/mod.py": ("from .sibling import a\n"
                                "from ..up import b\n"
                                "from ...top import c\n"),
        "pkg/sub/deep/sibling.py": "",
        "pkg/sub/up.py": "",
        "pkg/top.py": "",
    }
    assert edges(files) == {
        ("pkg/sub/deep/mod.py", "pkg/sub/deep/sibling.py"),
        ("pkg/sub/deep/mod.py", "pkg/sub/up.py"),
        ("pkg/sub/deep/mod.py", "pkg/top.py"),
    }


def test_from_dot_import_names(edges):
    files = {
        "pkg/a.py": "from . import b, sub, CONSTANT\n",
        "pkg/b.py": "",
        "pkg/sub/__init__.py": "",
        "pkg/__init__.py": "CONSTANT = 1\n",
    }
    # Submodules resolve to their files; a plain attribute falls back to the package.
    assert edges(files) == {("pkg/a.py", "pkg/b.py"), ("pkg/a.py", "pkg/sub/__init__.py"),
                            ("pkg/a.py", "pkg/__init__.py")}


def test_relative_beyond_root_is_dropped(edges):
    assert edges({"a.py": "from ... import x\n", "x.py": ""}) == set()


def test_absolute_dotted_path_shortening(edges):
    files = {
        "main.py": ("import app.models.user\n"
                    "from app.services import billing\n"
                    "from app.util import helper_func\n"
                    "import app.util.missing.deeper\n"),
        "app/__init__.py": "",
        "app/models/user.py": "",
        "app/services/billing.py": "",
        "app/util.py": "",
    }
    assert edges(files) == {
        ("main.py", "app/models/user.py"),
        ("main.py", "app/services/billing.py"),  # submodule name
        ("main.py", "app/util.py"),              # function in a module → the module
    }


def test_package_init_resolution(edges):
    files = {"run.py": "import tools\nfrom tools import x\n", "tools/__init__.py": ""}
    assert edges(files) == {("run.py", "tools/__init__.py")}


def test_relative_module_falls_back_within_the_package(edges):
    files = {"pkg/a.py": "from .b.c import thing\n", "pkg/b/__init__.py": "", "pkg/b/x.py": ""}
    assert edges(files) == {("pkg/a.py", "pkg/b/__init__.py")}


def test_stdlib_and_third_party_produce_no_edge(edges):
    files = {
        "app.py": ("import os, sys\nimport numpy as np\nfrom django.db import models\n"
                   "from typing import Any\n"),
        "helpers.py": "",
    }
    assert edges(files) == set()


def test_star_import(edges):
    assert edges({"a.py": "from b import *\n", "b.py": ""}) == {("a.py", "b.py")}
