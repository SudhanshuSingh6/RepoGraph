# Repograph

See how a codebase fits together — drop in a repository and explore it as a tree, a size map, a dependency graph, a UML architecture diagram, an ER diagram, and a hotspot report, with an AI chat panel that can read the actual source to answer questions.

This is the full product build of Repograph, evolving the original single-file browser prototype (parsing + all six views run client-side in vanilla JS/D3) into a hosted app with accounts, saved projects, and a cost-controlled AI chat backed by real multi-language parsing.

**Status:** this repo doesn't exist yet. `README.md`/`BUILD_PLAN.md`/`docs/repograph-spec.md` are the plan; everything below — `package.json`, migrations, `.env.example` — is what **Phase 1** of `BUILD_PLAN.md` produces, not something you can run today. Start there.

## Tech stack

One deployable app, kept intentionally small. Nothing below is run "because it might be needed" — see [Scaling roadmap](#scaling-roadmap) for what's deferred and why.

| Layer | Technology | Role |
|---|---|---|
| App (frontend + backend) | **SvelteKit** | Six analytical views, chat panel, account/usage UI, login — and all server routes (Auth, Project, Chat, Usage). No separate API framework. |
| Parsing | **Python + py-tree-sitter** | Structural parsing for Java, JavaScript, TypeScript, Python. Runs as a background worker process, invoked (not awaited) by the SvelteKit import route. |
| Database | **PostgreSQL** | Users, sessions, projects, parsed graph data, usage/quota records. |
| Auth | **GitHub OAuth, read-only** | Login via `read:user`. Public-repo import needs no repo-scoped grant; private-repo import is an explicit opt-in via a GitHub App with read-only `contents` permission (not the broad `repo` scope — see `BUILD_PLAN.md` Phase 2). |
| AI chat | **Anthropic API** | Tool-calling chat (`getFile`, `searchFiles`, `listChildren`) over the parsed repo, with prompt caching on the repo-context block and an atomic per-user quota reservation before each call. |
| Billing | **Stripe** | Added once paid plans are turned on — not required for the free tier. |
| Testing | **PyTest**, **Vitest**, **Testcontainers**, **Playwright** | Unit (PyTest for the Python parser, Vitest for the TS graph-analysis layer), integration (service ↔ DB), end-to-end. |

## Architecture

Four layers, one deployable:

```
Presentation   SvelteKit routes/components — 6 views, Chat Panel, Account/Usage UI, Login
      │
Application    SvelteKit server routes — Auth, Project (import lifecycle),
      │        Chat (+ quota check), Usage/Billing
      │
Domain         Language Parsers (Python, py-tree-sitter, separate worker process)
      │        + Graph Analysis (TS package — SCC/cycles, blast radius, hotspots)
      │
Data           Repositories (data access) → Postgres
```

External calls: Auth/Project → **GitHub** (OAuth, repo clone); Chat → **Anthropic API** (tool-calling, prompt-cached).

**Patterns in use:** Strategy (interchangeable per-language parsers behind one interface), Facade (a single `analyse(repo)` entry point hides parsing/graph/SCC/blast-radius from the API layer), Observer (import/parse progress events pushed to the UI).

## Features

- **Import** a public repo via GitHub (no auth needed to read it) or a direct ZIP/folder upload (zip-slip-protected, size/file-count capped); private-repo import requires the opt-in GitHub App install. Parsed with py-tree-sitter for Java, JS, TS, Python.
- **Tree** — node-link diagram of the repo structure.
- **Size map** — treemap sized by line count, colorable by language / fan-in / fan-out / cycle membership.
- **Dependencies** — force-directed import graph with folder clustering, spacing control, and blast-radius highlighting.
- **Architecture** — UML-style component diagram (layered by import depth) drilling into per-package class diagrams.
- **ER Diagram** — entities/relationships detected from JPA/Hibernate, Django, SQLAlchemy, TypeORM.
- **Hotspots** — largest files, most-imported files, import cycles, and possibly-unused ("dead") code.
- **Chat** — ask questions about the open repo; the assistant calls `getFile`/`searchFiles`/`listChildren` to read real source before answering, scoped by a per-user usage quota.

## Project structure

```
repograph/
├─ src/
│  ├─ routes/              # SvelteKit pages + server endpoints (Auth, Project, Chat, Usage)
│  ├─ lib/
│  │  ├─ views/            # Tree, Treemap, Graph, UML, ER, Hotspots (D3-based)
│  │  ├─ chat/             # tool definitions, context builder, prompt-cache wiring
│  │  └─ ui/                # shared components (side panel, toolbar, chips, search)
│  └─ app.d.ts
├─ packages/
│  └─ analysis/             # TS graph-analysis package (SCC, blast radius, tree builder) — no parsing here
│     └─ graph/
├─ workers/
│  ├─ parse_worker.py       # Python, py-tree-sitter — the actual parsing logic for one project
│  └─ worker_loop.py        # long-running process: polls the parse_jobs table, calls parse_worker.py per claimed job
├─ db/
│  └─ migrations/           # Postgres schema
├─ tests/
│  ├─ unit/                 # PyTest (parsers) / Vitest (graph analysis)
│  ├─ integration/          # Vitest + Testcontainers
│  └─ e2e/                  # Playwright
└─ README.md
```

## Getting started

*(This section describes the result of `BUILD_PLAN.md` Phase 1 onward — there's nothing to `git clone` yet if you're starting from just this plan.)*

### Prerequisites
- Node.js 20+
- Python 3.11+ (parse worker)
- PostgreSQL 15+ (local, or via Docker)
- A GitHub OAuth App — `read:user` scope only — or a GitHub App if you're supporting private-repo import (see Tech stack above)
- An Anthropic API key

### Setup

```bash
git clone <repo-url>
cd repograph
npm install

cp .env.example .env   # fill in the values below
npm run db:migrate
npm run dev
```

### Environment variables

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/repograph

GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=http://localhost:5173/auth/github/callback

ANTHROPIC_API_KEY=...
CHAT_DAILY_QUOTA=50          # messages per user per day, atomically reserved server-side

IMPORT_MAX_BYTES=209715200   # 200MB decompressed/cloned size cap
IMPORT_MAX_FILES=20000       # file-count cap, checked during extraction/clone

PARSE_MAX_ATTEMPTS=3         # parse_jobs retries before a project is marked 'error' for good
PARSE_STALE_TIMEOUT_MIN=15   # a 'processing' job older than this is assumed hung and reclaimed

# Optional — only needed once billing is turned on
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

## Testing

```bash
npm run test:unit          # Vitest — TS graph analysis, chat context builder
pytest                     # parser unit tests — tests workers/parse_worker.py directly
npm run test:integration   # Vitest + Testcontainers — spins up an ephemeral Postgres
npm run test:e2e           # Playwright — full import → visualize → chat flow
```

## Build phases

Each phase ships something runnable and the next phase builds on data/structures the previous one created.

**Phase 1 — Scaffold**
SvelteKit project, Postgres connection + migration tooling, base layout (header, empty workspace shell), CI running lint + unit tests on push. No features yet — just a deployable skeleton.

**Phase 2 — Auth**
GitHub OAuth flow with `state`/PKCE verification and a read-only scope (`read:user` only — no blanket `repo` grant), session handling, `users`/`sessions` tables, a logged-in/out header state. Nothing else is gated behind it yet — this phase just proves login works end to end.

**Phase 3 — Import & parsing**
Project import (GitHub repo URL → shallow clone, or ZIP/folder upload with zip-slip protection and size/file-count caps), a Postgres-backed `parse_jobs` table, and a long-running Python `worker_loop.py` process (py-tree-sitter per language) that polls and claims jobs — the API route only inserts a job row and returns immediately; nothing is awaited in-request, and a crashed/restarted worker resumes rather than silently losing the job. `projects`/`parsed_files` tables, owner checks on every project route. Verify by importing a real repo and confirming parsed file count, language breakdown, and import-edge count are correct against something you can check by hand.

**Phase 4 — Graph analysis**
Port the artifact's derivation logic into the `analysis` package: fan-in/out, Tarjan SCC (cycles), BFS blast radius, the folder-hierarchy tree builder. No UI yet — verify against the same known-cycle fixture approach used for the original artifact.

**Phase 5 — Core views: Tree, Size map, Dependencies**
Port the D3 rendering code into Svelte components reading from Phase 4's output. These three first since they share the most structure and are the fastest to get interaction-complete.

**Phase 6 — Architecture (UML) + ER Diagram**
Shared layered-DAG layout component, then class/component extraction and ORM entity/relationship extraction (same detection rules as the original: JPA, Django, SQLAlchemy, TypeORM).

**Phase 7 — Hotspots + dead-code detection**
Mostly sorts over Phase 4's output; dead-code detection depends on Phase 6's type extraction, so build it last in this phase.

**Phase 8 — Side panel + global filters/search**
Overview/selection states, language chips, "hide tests", search — wired across all six views now that they all exist.

**Phase 9 — Persistence**
Save/reopen a project without re-importing; "my projects" list on the account page. This is the first phase where Postgres is used for more than auth.

**Phase 10 — Chat**
Static UI, then the three tools (`getFile`/`searchFiles`/`listChildren`) against Phase 3/4's real parsed data, then the Anthropic API call with prompt caching on the context block, then the per-user quota check (`CHAT_DAILY_QUOTA`) gating it.

**Phase 11 — Usage/account UI**
Plan/usage display, quota meter, upgrade entry point (stubbed — no real Stripe charge yet).

**Phase 12 — Billing**
Wire Stripe for real once you're ready to charge; everything in Phase 11 already has the UI shape, this phase makes it actually move money.

**Phase 13 — Hardening & deploy**
Full Playwright e2e pass across the import → visualize → chat flow, error/empty states for every view, responsive pass, production deploy.

## Designing for the scaling roadmap

The stack stays lean (§ above), but it's built so every deferred addition is a **swap behind an existing interface**, not a rewrite — the same way prompt caching dropped cleanly into Phase 10's chat call without touching anything else. Build these seams in from Phase 1, even though their real implementation stays simple until the trigger in the roadmap table actually happens:

| Seam | Day-one implementation | Swaps in later for |
|---|---|---|
| `enqueueParseJob(projectId)` — one function, not an inline call in the API route | Inserts a row into a Postgres `parse_jobs` table; a separate long-running Python worker process polls and claims it (durable across app restarts — not a detached child process spawned per request, which would lose the job if it crashed) | **Redis + BullMQ**: same function signature, body becomes `queue.add(...)`; nothing calling it changes, and the durability property carries over since both are backed by persistent storage |
| `packages/analysis` has zero SvelteKit imports — pure functions in, data out | Called in-process from the SvelteKit server route | **A separate service (Fastify or otherwise)**: lift the package behind an HTTP/RPC boundary; callers still just call a function, now over the network |
| DB access through repository functions (`getProject()`, `getParsedFiles()`, …), never raw queries scattered in routes | Direct Postgres queries | A cache layer in front of hot reads, or read replicas — add inside the repository function, zero call-site changes |
| Chat's tool list is an array the model receives, not three hardcoded branches | Three tools: `getFile`, `searchFiles`, `listChildren` | **pgvector semantic search**: add a fourth tool (`semanticSearch`) to the same array once it's actually built; the other three, the context-builder, and the caching all stay untouched. (The `vector` extension and an `embedding` column are added *then*, as a real migration — not pre-created early, to avoid the stack carrying unused schema before it's needed.) |
| File content read/written through one `fileStorage` module | Reads/writes the Postgres `content` column | Swap the module's internals to S3/R2 if repos get large enough that Postgres rows aren't the right place for source text — callers unaffected |
| Sessions live in Postgres, not server memory | Single app instance in dev | The app is already stateless — running multiple instances behind a load balancer needs no code change, just more instances |
| `reserveQuota(userId)` / `releaseQuota(userId)` as functions (atomic reserve, not check-then-increment), not inline SQL in the chat route | Backed by the `chat_usage` daily-counter table, incremented and checked in one statement | Swap internals to a Redis-based counter if you need sub-second quota checks at higher chat volume — call sites don't change, and the atomicity requirement carries over |

Add each of these as the actual shape of Phase 1–3's code (small wrapper functions, one package boundary) even though what's *behind* them stays as simple as possible until the roadmap table's trigger fires. The cost is a handful of one-line indirection functions; the payoff is that every later addition is additive.

## Scaling roadmap

Deliberately not in the stack yet — add each only when its trigger actually happens, not in anticipation:

| Addition | Add it when… |
|---|---|
| A separate backend service (e.g. Fastify) | Parsing needs to scale independently of web traffic, or you need long-lived streaming connections at a scale SvelteKit's request model can't handle. |
| Redis + BullMQ (job queue) | In-process/synchronous parsing becomes a bottleneck — concurrent imports start queuing visibly. |
| pgvector + embeddings | Chat sessions are routinely burning multiple tool round-trips per question on large repos. Add as a fourth tool (`semanticSearch`) alongside the existing three, not a replacement for them. |
| Stripe integration (beyond stub) | Paid plans actually launch. |

## License

TBD.
