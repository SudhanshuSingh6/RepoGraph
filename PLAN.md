# RepoGraph — Implementation Plan

> Build order follows the dependency chain: you cannot visualize what you haven't parsed, and you cannot do GraphRAG without a graph. Each phase produces a shippable slice that can be demoed independently.

---

## Phase 0 — Scaffold (Day 1)

Get a skeleton running end-to-end so every later phase has a place to land.

### 0.1 Repo layout
```
repograph/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI entry point
│   │   ├── api/             # route modules
│   │   ├── core/            # config, db clients, settings
│   │   ├── ingestion/       # clone + zip handling
│   │   ├── parser/          # tree-sitter, symbol table, cross-file resolution
│   │   ├── graph/           # neo4j queries and write helpers
│   │   ├── analysis/        # metrics, cycle detection, heatmap
│   │   └── ai/              # embeddings, vector index, graphrag, llm
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      # graph canvas, inspector, sidebar, chat
│   │   ├── pages/           # dashboard, explorer, heatmap, api-viz, chat
│   │   ├── hooks/
│   │   └── api/             # typed fetch wrappers
│   └── package.json
├── docker-compose.yml        # neo4j + backend + frontend
└── PLAN.md
```

### 0.2 Infrastructure
- `docker-compose.yml` with Neo4j 5 (ports 7474/7687), backend, frontend
- Backend: FastAPI with `/health` returning `{ "status": "ok" }`
- Frontend: Vite + React + Tailwind skeleton rendering `RepoGraph` heading
- Confirm hot-reload works for both

### 0.3 Config & secrets
- `backend/app/core/config.py` — pydantic `Settings` reading from `.env`
- Fields: `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `GEMINI_API_KEY` (optional), `REPO_SIZE_LIMIT_MB`
- `.env.example` committed; `.env` in `.gitignore`

**Exit criterion:** `docker-compose up` → frontend loads, `/health` returns 200, Neo4j browser accessible.

---

## Phase 1 — Ingestion (Days 2–3)

Accept a repo from the user, land it on disk safely, detect its language.

### 1.1 GitHub clone
- `POST /api/repos/clone` — body `{ "url": "<github-url>" }`
- Validate URL is a real GitHub HTTPS URL (regex; reject SSH, non-github)
- Shallow clone (`--depth 1`) into a temp working directory
- Enforce `REPO_SIZE_LIMIT_MB` (check unpacked size after clone)
- Return `{ "repo_id": "<uuid>", "path": "<local-path>", "detected_language": "..." }`

### 1.2 ZIP upload
- `POST /api/repos/upload` — multipart `file`
- Safe extraction: reject paths with `..`, absolute paths, symlinks outside root
- Same size limit and language detection as clone path

### 1.3 Language detection
- Walk the file tree, tally extensions by file count and byte count
- Supported set (v1): Python, JavaScript, TypeScript, Java
- Return primary language + breakdown; store in repo metadata node in Neo4j

### 1.4 Ignore rules
- Hard-coded skip list: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `*.min.js`, `vendor`
- Configurable via a top-level `IGNORE_DIRS` constant

**Exit criterion:** Clone `pallets/flask` → JSON back with detected language `Python`, no error.

---

## Phase 2 — Parsing & Graph Build (Days 4–8)

This is the hardest phase. The quality of everything downstream depends on correct cross-file resolution.

### 2.1 Tree-sitter setup
- Install `tree-sitter` + language grammars for Python, JS/TS, Java
- Write a `Parser` base class: `parse_file(path) -> AST`
- Language-specific subclasses: `PythonParser`, `JavaScriptParser`, `JavaParser`

### 2.2 Node extraction — single-file pass
Each parser extracts from its AST:

| Node type       | What to capture                                      |
|-----------------|------------------------------------------------------|
| `Package`       | directory path, name                                 |
| `File`          | path, language, line count                           |
| `Class`         | name, start/end line, docstring if present           |
| `Interface`     | name, start/end line                                 |
| `Enum`          | name, members                                        |
| `Method`        | name, parent class, parameter list, return type hint |
| `RestEndpoint`  | HTTP verb, route string, handler method              |
| `ExternalLib`   | import name (not resolvable to a local file)         |

### 2.3 Local edges — single-file pass
Extracted at the same time as nodes:
- `CONTAINS` — Package→File, File→Class, Class→Method, etc.
- `IMPORTS` — File→ExternalLib (for unresolvable imports)
- `EXPOSES_ENDPOINT` — File→RestEndpoint

### 2.4 Symbol table — pass 1
After all files are parsed:
- Build `symbol_table: dict[qualified_name, NodeId]`
- Key format: `<repo_id>::<file_path>::<symbol_name>` (and shorter aliases for common resolution)
- Also index by bare name for fallback resolution

### 2.5 Cross-file edge resolution — pass 2
Walk every file again; for each:
- **`IMPORTS` (local):** resolve relative/absolute import paths → target File node; add `IMPORTS` edge
- **`CALLS`:** for each call site, look up callee in symbol table → add `CALLS` edge (Method→Method or Method→ExternalLib)
- **`EXTENDS` / `IMPLEMENTS`:** look up parent/interface name in symbol table → add edge

Unresolved symbols are logged and skipped (not errors — third-party or dynamic).

### 2.6 Neo4j schema
```cypher
// Constraints
CREATE CONSTRAINT repo_id IF NOT EXISTS FOR (r:Repo) REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE f.path IS UNIQUE;
CREATE CONSTRAINT node_id IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE;

// Index for embedding vector search (Phase 5)
CREATE VECTOR INDEX node_embeddings IF NOT EXISTS
  FOR (n:Node) ON (n.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 384, `vector.similarity_function`: 'cosine' } };
```

### 2.7 Ingestion API
- `POST /api/repos/{repo_id}/parse` — triggers parse + graph build; returns job status
- `GET /api/repos/{repo_id}/status` — `{ "status": "parsing" | "ready" | "error" }`
- Store progress in a lightweight in-process state dict (no queue needed for v1)

**Exit criterion:** Parse `pallets/flask` → Neo4j contains File, Class, Method nodes with correct `CALLS` edges between `Flask.route` decorator and handler methods.

---

## Phase 3 — Graph Visualization (Days 9–12)

Make the graph interactive in the browser.

### 3.1 Graph query API
- `GET /api/repos/{repo_id}/graph` — returns Cytoscape-ready JSON
  ```json
  { "nodes": [{ "data": { "id": "...", "label": "...", "type": "Class", ... } }],
    "edges": [{ "data": { "source": "...", "target": "...", "type": "CALLS" } }] }
  ```
- Optional query params: `type` (filter by node type), `limit` (pagination for large repos)
- Neighbour expansion: `GET /api/nodes/{node_id}/neighbours?depth=1`

### 3.2 Cytoscape canvas
- `<GraphCanvas>` component renders nodes + edges with Cytoscape.js
- Default layout: `fcose` (force-directed, handles large graphs)
- Node color by type (Package=blue, Class=green, Method=purple, RestEndpoint=orange, ExternalLib=grey)
- Pan/zoom/drag out of the box from Cytoscape

### 3.3 Controls sidebar
- Search box: filter nodes by name (client-side for small graphs, API call for large)
- Filter checkboxes: toggle node types on/off
- "Reset view" button

### 3.4 Node inspector panel
Opens on node click (slide-in panel on the right):
- Node name, type, file path
- Source code in Monaco Editor (read-only, syntax-highlighted, correct language)
- Incoming references list (who calls/imports/extends this)
- Outgoing references list (what this calls/imports/extends)
- Complexity metrics (Phase 4 adds these)

### 3.5 Neighbour expand
- Clicking "Expand" in inspector loads 1-hop neighbours via `/api/nodes/{id}/neighbours`
- Adds new nodes/edges to the live Cytoscape instance without re-rendering the whole graph

**Exit criterion:** Open parsed Flask repo → see a browsable graph; click `Flask` class → inspector shows its methods and source.

---

## Phase 4 — Analysis Features (Days 13–16)

Pure Neo4j + AST metrics; zero LLM calls.

### 4.1 Architecture dashboard
`GET /api/repos/{repo_id}/overview`
```json
{
  "total_packages": 12,
  "total_files": 87,
  "total_classes": 203,
  "total_methods": 1421,
  "total_external_deps": 34,
  "largest_package": { "name": "auth", "file_count": 18 },
  "most_connected_class": { "name": "UserService", "edge_count": 47 },
  "avg_class_complexity": 8.3
}
```
All computed from Neo4j aggregation queries; rendered as stat cards on the dashboard.

### 4.2 Complexity metrics
Computed during parse (Phase 2) and stored on Method/Class nodes:
- **Lines of code** — `end_line - start_line`
- **Cyclomatic complexity** — count branch points (`if`, `for`, `while`, `except`, `and`, `or`, ternary) + 1
- **Fan-in** — number of incoming `CALLS` edges (updated in pass 2)
- **Fan-out** — number of outgoing `CALLS` edges

### 4.3 Complexity heatmap
- `GET /api/repos/{repo_id}/heatmap` — returns nodes with complexity scores
- Frontend: same Cytoscape canvas, node **color** = cyclomatic complexity bucket (green/yellow/orange/red), node **size** = lines of code
- Legend panel showing the scale

### 4.4 Dependency explorer
`GET /api/nodes/{node_id}/dependencies`
```json
{
  "used_by": ["AuthenticationController", "AdminController"],
  "depends_on": ["UserRepository", "RedisCache", "EmailService"]
}
```
- `used_by` = nodes with `CALLS` / `IMPORTS` / `EXTENDS` edge **into** this node
- `depends_on` = nodes this node calls/imports/extends
- Rendered in the inspector as two columns (see design spec)

### 4.5 Circular dependency detection
- `GET /api/repos/{repo_id}/cycles`
- Neo4j query: `MATCH path = (a)-[:IMPORTS|CALLS*2..10]->(a) RETURN path LIMIT 50`
- Returns list of cycles with node lists
- Frontend: button "Show cycles" highlights cycle edges in red in the graph

### 4.6 API endpoint visualization
`GET /api/repos/{repo_id}/endpoints`
- List of all detected REST endpoints with their full call chain:
  `POST /login → AuthController.login() → AuthService.authenticate() → JwtProvider.sign() → UserRepository.findByEmail()`
- Chain built by following `CALLS` edges from the handler method
- Frontend: endpoint list → click → highlights the chain nodes in the graph canvas

**Exit criterion:** Flask repo dashboard shows correct counts; click `Request` class → dependency explorer shows its 5 dependents and 3 dependencies; cycle detection finds Flask's internal circular imports.

---

## Phase 5 — AI Assistant / GraphRAG (Days 17–21)

The only phase that calls an LLM. Keep it isolated so it can be swapped or disabled.

### 5.1 Embeddings
- Model: `sentence-transformers/all-MiniLM-L6-v2` (local, 384-dim, MIT license)
- At graph-build time, for each node compute embedding of: `"{type} {name}: {docstring or first 3 lines of source}"`
- Write embedding into Neo4j `node.embedding` property → picked up by the vector index created in Phase 2

### 5.2 Semantic search
`GET /api/repos/{repo_id}/search?q=<query>&limit=10`
- Embed the query with the same model
- `db.index.vector.queryNodes('node_embeddings', 10, $embedding)` → ranked node list
- Used both by the chatbot seed step and as a standalone search endpoint

### 5.3 Subgraph retrieval
Given seed node(s) from semantic search:
- Traverse 2 hops in Neo4j: `MATCH (seed)-[*1..2]-(neighbor) RETURN neighbor`
- Collect up to ~20 nodes; fetch their source snippets (capped at 200 lines each)
- Build a compact context string: node summaries + relevant source (~2–5k tokens total)

### 5.4 Query routing
Before calling an LLM, classify the question:

| Question pattern | Route |
|-----------------|-------|
| "which classes depend on X" | Neo4j → dependency explorer API |
| "what breaks if I change X" | Neo4j → fan-in traversal |
| "list all endpoints" | Neo4j → endpoint list API |
| "explain X", "what does X do", "how does auth work" | GraphRAG → LLM |

Simple keyword classification (no ML): if question contains `list`, `which`, `how many`, `find all`, `show` → structural route. Otherwise → LLM.

### 5.5 LLM integration
- Primary: Gemini 2.0 Flash (free tier, sufficient for ≤5k token subgraphs)
- Fallback: Ollama (`llama3.2` or `mistral`) for fully local operation
- Toggle via `LLM_PROVIDER=gemini|ollama` env var
- System prompt includes: retrieved subgraph summary, node source snippets, question
- Stream the response token-by-token to the frontend via SSE

### 5.6 Chat UI
- `<ChatPanel>` component: message history, input box, send button
- Renders Markdown in responses (code blocks, lists)
- Structural answers (from Neo4j) rendered as a highlighted subgraph in the canvas
- LLM answers streamed word-by-word with a typing indicator

**Exit criterion:** Ask "explain how Flask handles requests" → GraphRAG retrieves `Flask`, `App`, `Request` nodes + source → Gemini streams a coherent explanation citing actual method names from the repo.

---

## Phase 6 — Polish & Hardening (Days 22–24)

### 6.1 Error handling
- Global FastAPI exception handler → consistent `{ "error": "...", "code": "..." }` JSON
- Frontend: toast notifications for API errors; loading skeletons during parse

### 6.2 Performance
- Large repos (>50k nodes): paginate graph API, load only visible viewport nodes
- Neo4j query timeouts (`SET dbms.transaction.timeout=30s`)
- Embedding batch size tuning (process 100 nodes at a time)

### 6.3 Security
- ZIP extraction: enforce no symlinks, no `../` paths, max-file-count limit
- GitHub URL validation: strict regex, no redirects followed
- No user-supplied strings injected into Cypher (parameterized queries only)
- CORS restricted to `localhost` in development

### 6.4 Testing
- Unit tests: symbol table resolution (Python imports, JS `require`/`import`, Java imports)
- Integration test: parse a small known repo, assert specific nodes/edges exist in Neo4j
- E2E (Playwright): clone repo → parse → graph loads → inspector opens → chat returns answer

### 6.5 Documentation
- `README.md` — quick start (5 commands to running demo)
- `docs/architecture.md` — the two-pass resolution algorithm explained with diagrams
- `docs/graphrag.md` — how the RAG pipeline works, token budget math

---

## Milestone summary

| Phase | Deliverable | Demo |
|-------|-------------|------|
| 0 | Scaffold | `curl /health` returns 200 |
| 1 | Ingestion | Clone Flask, get language detection back |
| 2 | Parser + Graph | Neo4j has correct CALLS edges for Flask |
| 3 | Visualization | Browse Flask graph, click nodes, see source |
| 4 | Analysis | Dashboard, heatmap, cycles, API paths |
| 5 | AI Assistant | "Explain request handling" → streamed answer |
| 6 | Polish | Prod-ready error handling, tests, docs |

---

## Critical path

```
Phase 0 → Phase 1 → Phase 2.1–2.3 (single-file) → Phase 3 (early canvas)
                  → Phase 2.4–2.5 (cross-file)   → Phase 4 (analysis)
                                                  → Phase 5 (AI)
                                                  → Phase 6 (polish)
```

Phase 3 can be started on partial graph data (single-file nodes only) while cross-file resolution is still being built — this lets frontend and backend work in parallel after Phase 2.3.

---

## Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Cross-file resolution wrong for dynamic languages (JS) | High | Start with Python (static imports); JS as stretch |
| Neo4j vector index needs Enterprise edition | Low | Native vector index ships in Neo4j 5 Community |
| Gemini free tier rate limits | Medium | Implement retry + local Ollama fallback |
| Large repos (>500 files) slow to parse | Medium | Background job model; stream progress via SSE |
| Tree-sitter grammar gaps for edge cases | Low | Log parse failures; don't fail the whole repo |
