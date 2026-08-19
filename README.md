# RepoGraph

Transform any codebase into an **interactive knowledge graph** — with graph-aware AI that explains code, traces impact, and answers architecture questions.

Paste a GitHub URL or drop a ZIP. RepoGraph parses the code with tree-sitter, builds a Neo4j graph of packages, files, classes, methods, and their relationships (calls, imports, inheritance, REST endpoints), and serves it through an explorable Cytoscape canvas with dashboards, complexity heatmaps, cycle detection, and a GraphRAG-powered assistant.

## Screenshots

| | |
|---|---|
| ![Repository Dashboard](docs/img/dashboard.png) | ![Graph Visualization](docs/img/graph.png) |
| Repository Dashboard | Graph Visualization |
| ![Dependency Explorer](docs/img/dependencies.png) | ![Complexity Heatmap](docs/img/heatmap.png) |
| Dependency Explorer | Complexity Heatmap |
| ![API Flow](docs/img/api-flow.png) | ![AI Chat](docs/img/ai-chat.png) |
| API Flow | AI Chat |

## Features

- **Multi-language parsing** — Python, JavaScript/TypeScript, Java via tree-sitter, with two-pass cross-file symbol resolution
- **Levelled graph exploration** — packages → files → classes → methods, lazy-loaded on click
- **Repository health score** — 0–100 with star rating and actionable warnings
- **Complexity heatmap** — nodes colored by cyclomatic complexity, sized by LOC, with hover metrics
- **Circular dependency detection** — full cycle paths (A→B→C→A), jump-to-graph
- **API flow tracing** — REST endpoint → handler → full call chain as a vertical flow
- **Semantic search** — find code by meaning, powered by local ONNX embeddings (no GPU)
- **AI assistant (GraphRAG)** — Explain / Summarize / Impact per node, plus freeform chat with clickable node references and source citations (Gemini)

## Quick start (Docker)

```bash
cp .env.example .env          # add GEMINI_API_KEY for AI features (optional)
docker compose up --build
```

Open http://localhost:5173.

## Local development

```bash
# 1. Neo4j only in Docker
docker compose up -d neo4j

# 2. Backend (from backend/, needs backend/.env — see below)
pip install -r requirements.txt
python3 -m uvicorn app.main:app --reload

# 3. Frontend
cd frontend && npm install && npm run dev
```

`backend/.env` for local dev:

```
NEO4J_URI=bolt://localhost:7687
REPOS_BASE_PATH=/absolute/path/to/RepoGraph/repos_data
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEO4J_URI` | `bolt://neo4j:7687` | Bolt connection (use `bolt://localhost:7687` locally) |
| `NEO4J_USER` / `NEO4J_PASSWORD` | `neo4j` / `repograph` | Neo4j auth |
| `GEMINI_API_KEY` | *(empty)* | Enables AI features; everything else works without it |
| `REPO_SIZE_LIMIT_MB` | `500` | Max clone/upload size |
| `REPOS_BASE_PATH` | `/repos` | Where cloned/extracted repos live |

## Performance

Parsing [Flask](https://github.com/pallets/flask) on a laptop:

| Metric | Value |
|--------|-------|
| Files parsed | 83 |
| Graph nodes | ~2,100 |
| Graph edges | ~2,500 |
| Parse time | ~11 s |
| Embedding time (1,037 nodes) | ~25 s |

## Development

```bash
cd backend
ruff check . && ruff format .   # lint + format
python3 -m pytest tests/        # unit tests (integration auto-skips without Neo4j)
pre-commit install               # run hooks on every commit
```

## Manual E2E checklist

1. Import `https://github.com/pallets/flask` from the homepage → parse progress → graph renders
2. Click a package → files appear; click a file → classes; click a method → Inspector opens with source
3. Toggle Complexity Heatmap → nodes recolor, hover shows metrics tooltip
4. Detect Cycles → panel lists full paths, Jump highlights them red
5. API Endpoints → vertical flow per route, steps clickable
6. Search "url routing" → relevant nodes highlighted purple with previews
7. Inspector → Explain streams an answer with Sources; second click replays instantly (cache)
8. Ask AI → "Which classes handle sessions?" → answer with clickable node names

## Docs

- [Architecture](docs/architecture.md) — pipeline, two-pass resolution, graph schema
- [GraphRAG](docs/graphrag.md) — embeddings, vector search, token-budget context
