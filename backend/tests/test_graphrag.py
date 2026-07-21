"""GraphRAG pipeline tests — Gemini and vector search are mocked.

Verifies: correct nodes retrieved into context, token budget respected,
no duplicate node contexts, expected source snippets present, citations collected.
"""

import pytest

import app.ai.search as search_mod
from app.ai import tools
from app.ai.context import estimate_tokens, match_mentioned_nodes

FAKE_HITS = [
    {
        "id": f"n{i}",
        "name": name,
        "type": "Class",
        "file_path": f"src/{name.lower()}.py",
        "score": 0.9 - i * 0.05,
        "preview": f"Class: {name}",
    }
    for i, name in enumerate(
        ["AuthService", "UserRepo", "JwtProvider", "Cache", "Mailer", "A", "B", "C", "D", "E"]
    )
]


def make_fake_context(calls_log):
    async def fake_build_node_context(driver, node_id, repos_base):
        calls_log.append(node_id)
        hit = next(h for h in FAKE_HITS if h["id"] == node_id)
        return {
            "node": {
                "id": hit["id"],
                "label": hit["name"],
                "type": "Class",
                "file_path": hit["file_path"],
            },
            "source": f"class {hit['name']}:\n    def run(self): ...",
            "language": "python",
            "calls": ["helper"],
            "used_by": ["Controller"],
            "imports": [],
        }

    return fake_build_node_context


@pytest.fixture
def patched(monkeypatch):
    calls_log: list[str] = []

    async def fake_semantic_search(driver, repo_id, q, k=10):
        return FAKE_HITS

    monkeypatch.setattr(search_mod, "semantic_search", fake_semantic_search)
    monkeypatch.setattr(search_mod, "build_node_context", make_fake_context(calls_log))
    return calls_log


async def test_top_nodes_land_in_context(patched):
    context, hits, citations = await search_mod.build_chat_context(
        None, "repo1", "how does authentication work?", "/tmp"
    )
    assert "AuthService" in context
    assert "class AuthService" in context  # source snippet present
    assert hits[0]["name"] == "AuthService"


async def test_token_budget_respected(patched):
    context, _, _ = await search_mod.build_chat_context(
        None, "repo1", "question", "/tmp", max_tokens=4000
    )
    # blocks stop at the budget; the trailing name-only line adds a little
    assert estimate_tokens(context) <= 4100


async def test_small_budget_limits_blocks(patched):
    context, _, _ = await search_mod.build_chat_context(
        None, "repo1", "question", "/tmp", max_tokens=35
    )
    # one fake block costs ~32 tokens, so only one fits in 35
    assert context.count("### Class:") <= 1
    big_context, _, _ = await search_mod.build_chat_context(
        None, "repo1", "question", "/tmp", max_tokens=4000
    )
    assert big_context.count("### Class:") > 1  # larger budget admits more blocks


async def test_no_duplicate_node_contexts(patched):
    await search_mod.build_chat_context(None, "repo1", "question", "/tmp")
    assert len(patched) == len(set(patched))  # each node fetched at most once


async def test_citations_collected_and_unique(patched):
    _, _, citations = await search_mod.build_chat_context(None, "repo1", "question", "/tmp")
    assert "src/authservice.py" in citations
    assert len(citations) == len(set(citations))


def test_prompt_builder_includes_context_and_question():
    prompt = tools.repo_question("Where is login handled?", "### Class: AuthService", "Python")
    assert "Where is login handled?" in prompt
    assert "### Class: AuthService" in prompt
    assert "Sources:" in prompt


def test_explain_prompt_includes_collaborators():
    ctx = {
        "node": {"label": "AuthService", "type": "Class", "file_path": "a.py"},
        "source": "class AuthService: ...",
        "language": "python",
        "calls": ["JwtProvider.sign"],
        "used_by": ["LoginController"],
        "imports": ["bcrypt"],
    }
    prompt = tools.explain_node(ctx)
    assert "AuthService" in prompt
    assert "JwtProvider.sign" in prompt
    assert "LoginController" in prompt


def test_match_mentioned_nodes():
    name_map = {
        "AuthService": {"id": "n1", "name": "AuthService"},
        "UserRepo": {"id": "n2", "name": "UserRepo"},
        "Cache": {"id": "n3", "name": "Cache"},
    }
    text = "The **AuthService** delegates to **UserRepo** for persistence."
    mentioned = match_mentioned_nodes(text, name_map)
    ids = {m["id"] for m in mentioned}
    assert ids == {"n1", "n2"}
