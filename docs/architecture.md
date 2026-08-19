# Architecture

## Pipeline

```
GitHub URL / ZIP
      │
      ▼
 Ingestion (clone.py / zip_upload.py)
   · strict URL validation, safe extraction (no symlinks, no ../, size + count limits)
   · language detection by byte count
      │
      ▼
 Two-pass parser (parser/orchestrator.py)
   Pass 1: tree-sitter per file → nodes, intra-file edges, symbol table
   Pass 2: cross-file resolution → IMPORTS / CALLS / EXTENDS / IMPLEMENTS
      │
      ▼
 Neo4j 5 (graph/builder.py)
   · batched MERGE writes (500/batch), closed label allowlist
      │                                    │
      ▼                                    ▼
 REST API (FastAPI)                 Embeddings (ai/embeddings.py)
   graph / analysis / ai              · fastembed bge-small (384-dim)
      │                               · written to node_embeddings vector index
      ▼
 React + Cytoscape.js frontend
   levelled lazy-load canvas, dashboards, panels, AI chat
```

## Two-pass symbol resolution

**Pass 1** parses every file independently with the language-specific tree-sitter grammar and collects:

- `NodeData` — File, Class, Interface, Enum, Method, RestEndpoint (with complexity and LOC computed from the AST)
- intra-file `CONTAINS` edges
- unresolved references: `ImportRef`, `CallSite`, `InheritanceRef`

Every named node is registered in a `SymbolTable` under both a qualified key (`file_path::name`) and its bare name.

**Pass 2** walks the collected references:

- **Imports** — resolved per language: Python relative-dot handling (`.`, `..`) plus `module.py` / `module/__init__.py` candidates; JS/TS specifier resolution trying `.js/.jsx/.ts/.tsx` and `index.*`; Java FQN → path with a recursive fallback for nested source roots. Unresolvable imports become deduplicated `ExternalLib` nodes.
- **Inheritance** — `EXTENDS`/`IMPLEMENTS` by name lookup, preferring Class/Interface targets.
- **Calls** — callee name lookup preferring Methods, capped at 3 targets per call site, cross-file only.

This trades soundness for speed: no type inference, so dynamic dispatch is approximated by name. In practice it produces a useful graph in seconds even for large repos.

## Graph schema

**Node labels** (all also carry `:Node` with a unique `id`):

| Label | Key properties |
|-------|----------------|
| `Repo` | id, name, source_url, primary_language, language_breakdown |
| `Package` | name, file_path (directory) |
| `File` | name, file_path |
| `Class` / `Interface` / `Enum` | name, file_path, start/end_line |
| `Method` | name, complexity, lines, start/end_line |
| `RestEndpoint` | http_method, path |
| `ExternalLib` | name |

Embeddable nodes additionally get `embedding` (384-float vector) and `embed_text`.

**Edge types:**

| Type | Meaning |
|------|---------|
| `CONTAINS` | structural nesting (Package→File→Class→Method) |
| `IMPORTS` | File→File or File→ExternalLib |
| `CALLS` | Method→Method, RestEndpoint→Method |
| `EXTENDS` / `IMPLEMENTS` | inheritance |
| `EXPOSES_ENDPOINT` | File→RestEndpoint |

**Indexes:** unique constraints on `Node.id` and `Repo.id`; `node_embeddings` vector index (384-dim, cosine).

## API surface

- `/api/repos/*` — clone, upload, parse (202 + background task), status
- `/api/repos/{id}/graph|metrics|overview|heatmap|cycles|endpoints` — visualization + analysis
- `/api/nodes/{id}/children|neighbours|source|references|dependencies` — drill-down
- `/api/repos/{id}/search|chat|embed` and `/api/nodes/{id}/explain|summarize|impact` — AI (SSE streaming)
- `/api/health` (rich status), `/api/version`

Background jobs (parse, embed) run as asyncio tasks with progress in an in-memory, thread-safe status store.
