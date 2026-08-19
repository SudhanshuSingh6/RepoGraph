# GraphRAG — how the AI assistant works

RepoGraph's assistant is retrieval-augmented generation where the retrieval layer is the **code graph itself**: vector search finds entry points, graph traversal expands them into structured context, and Gemini generates over that context only.

## 1. Embeddings — selective and structured

Only node types that benefit from semantic search are embedded — `Class`, `Interface`, `Method`, `RestEndpoint`, `File`. Packages, enums, and external libs are skipped, cutting embedding time and storage roughly in half with no loss in search quality.

Each node's embedding text is structured, not just a name:

```
Method: authenticate

Class: AuthenticationService
File: auth_service.py

Imports:
UserRepository, JwtProvider, BcryptEncoder

def authenticate(self, email, password):
    user = self.user_repo.find_by_email(email)
    ...
```

(type + name, parent class, file, top file-level imports, first 500 chars of source.)

Model: `BAAI/bge-small-en-v1.5` via **fastembed** — 384-dim, ONNX, CPU-only, matches the `node_embeddings` cosine index in Neo4j. Embedding runs automatically as a background task after every parse (batches of 64, progress at `/embed/status`), and the text is stored on the node as `embed_text` so search results can show a preview.

## 2. Vector search

```cypher
CALL db.index.vector.queryNodes('node_embeddings', $k, $embedding)
YIELD node, score
WHERE node.repo_id = $repo_id AND score > 0.5
```

Results carry `{id, name, type, file_path, score, preview}` — the preview is the first 120 chars of `embed_text`. The same search powers the sidebar (highlighting hits on the canvas) and chat retrieval.

## 3. Token-budget context assembly

Instead of a fixed top-k, chat context is assembled to a **~4,000-token budget** (estimated at `len(text) / 4`):

1. Semantic search → top 10 candidates
2. For each of the top 5, build a context block: node metadata, callers/callees from the graph, and up to 1,200 chars of source
3. Add blocks until the budget is reached — **never truncate mid-block**
4. Remaining candidates contribute a one-line "other possibly relevant components" mention if space remains

This adapts to repo size: a small repo's whole relevant neighborhood fits; a huge repo gets its most relevant slice. File paths of every included block are collected as **source citations** and returned with the answer.

## 4. The five AI tools

Each tool is a named prompt template (`ai/tools.py`):

| Tool | Endpoint | Context |
|------|----------|---------|
| Explain Node | `POST /nodes/{id}/explain` | node source + callers/callees/imports; onboarding-engineer framing |
| Summarize Node | `POST /nodes/{id}/summarize` | source + contained method names; verb-first bullets |
| Impact Analysis | `POST /nodes/{id}/impact` | reverse CALLS/IMPORTS traversal up to 3 hops (≤30 nodes) |
| Architecture Question | `POST /repos/{id}/chat` (`tool: "architecture"`) | token-budget context, component focus |
| Repository Question | `POST /repos/{id}/chat` (`tool: "repo"`) | token-budget context + "Sources:" instruction |

All stream over SSE: `{"delta": ...}` events, then `{"done": true, "nodes": [{id, name}], "citations": [files]}`. The `nodes` list is computed by matching node names mentioned in the response against the repo's name→id map — the frontend renders them as clickable links that center, flash, and inspect the node.

## 5. Generation, caching, resilience

- **Model:** Gemini 1.5 Flash via the `google-genai` SDK (async streaming)
- **Cache:** in-memory, keyed `(repo_id, node_id, tool)`; hits replay in 40-char chunks at 10 ms so the UI still feels live — repeated "Explain" clicks cost zero API calls
- **Rate limits:** 429/RESOURCE_EXHAUSTED retried up to 2× (2 s, 8 s backoff) before surfacing an SSE `error` event
- **No key?** AI endpoints return 503 with a clear message; search and all analysis features work without one
