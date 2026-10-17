# Repograph — CLI Build Plan

Paste this whole file as your first message to Claude Code to kick off the project, or paste one phase at a time (recommended — review and commit after each phase before moving on). Each phase lists its goal, concrete tasks, any database changes, and acceptance criteria to check before starting the next one. Where a phase ports UI/behavior from the original browser prototype, it points at the exact section of `repograph-spec.md` (the extracted spec of that prototype) to copy from — paste that file into the session too, or keep it in the repo as `docs/repograph-spec.md` so Claude Code can read it directly.

**Tech stack** (full rationale in `README.md`): SvelteKit (frontend + backend, no separate API framework) · PostgreSQL · **a long-running Python worker process using py-tree-sitter** for parsing, polling a Postgres-backed job table — not spawned per-request by SvelteKit · TypeScript for the graph-analysis package and all view/UI code · GitHub OAuth (read-only, see Phase 2) · Anthropic API with prompt caching · Stripe (deferred) · PyTest (parser) / Vitest (TS)/Testcontainers/Playwright.

**Status: this is a plan, not a repo yet.** Nothing below exists until Phase 1 runs — there is no `package.json`, no migrations, nothing `README.md`'s "Getting started" section can execute. Run Phase 1 first; `README.md`'s setup steps describe what Phase 1 produces, not a currently-runnable state.

---

## Phase 1 — Scaffold

**Goal:** a deployable, empty SvelteKit app with Postgres wired up and CI running.

**Tasks:**
- If `README.md`/`BUILD_PLAN.md`/`docs/repograph-spec.md` already exist in this `repograph/` folder (e.g. from the planning bundle), run `npx sv create . --no-dir-check` **from inside that folder** — `sv create` refuses a non-empty target directory by default, and `--no-dir-check` skips that check so the Svelte scaffold is added alongside the existing docs instead of nesting a second `repograph/repograph/` folder. If starting from a genuinely empty directory instead, plain `npx sv create .` (or `npx sv create repograph` from the parent) is fine. Either way: TypeScript, ESLint, Prettier, Vitest. (Current SvelteKit CLI is `sv`; `npm create svelte@latest` is the old command.)
- Add dependencies: `pg` (or `postgres`/`drizzle-orm` — pick one ORM/query builder and use it consistently for every later phase's schema), `@anthropic-ai/sdk`.
- `docker-compose.yml` with a local Postgres service for development.
- `db/migrations/` folder + a migration runner script (`npm run db:migrate`).
- `.env.example` with every variable from `README.md`'s Environment Variables section (empty values).
- Base layout: header with brand mark + "Repograph" wordmark (reuse the SVG described in `repograph-spec.md` §3), empty `.workspace` placeholder route.
- GitHub Actions (or equivalent) CI: install, lint, `npm run test:unit` on every push.
- `README.md` and this `BUILD_PLAN.md` committed to the repo root.
- Establish the repository-function convention now: all database access goes through named functions in `src/lib/server/db/*.ts` (e.g. `getProject()`, `getParsedFiles()`), never raw queries inline in routes. This is what lets a cache layer or read replica be added later inside the function body with zero call-site changes — see `README.md`'s "Designing for the scaling roadmap" table.

**Acceptance criteria:** `npm run dev` serves the empty shell; `npm run db:migrate` runs against the Docker Postgres with zero migrations; CI passes on an empty test suite.

---

## Phase 2 — Auth

**Goal:** working GitHub OAuth login with sessions, nothing else gated behind it yet.

**Database:**
```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  github_id bigint unique not null,
  username text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

**Tasks:**
- **Scope correction:** do not request the `repo` scope. `repo` grants read **and write** to every public and private repository the user can access, plus organization resources — far more than Repograph needs to read code and show a dependency graph. Use **`read:user`** only for login/profile, and keep repo access scoped per-import instead of a blanket grant:
  - Default: import **public** repos only, which need no repo-scoped OAuth permission at all — GitHub's public API/clone works unauthenticated.
  - Private-repo import is a deliberate opt-in, and a **GitHub App with read-only `contents` permission is the only correct option** — there is no OAuth-App scope that grants read-only private-repo access. `public_repo` is public-only (it does not extend to private repos at all, confirmed against GitHub's own scope docs); the only OAuth-App scope that reaches private repos is the full `repo` scope this section exists to avoid. So: install a GitHub App per-repo/per-org when a user opts into private-repo import, rather than reaching for a broader OAuth scope as a fallback.
- `/auth/github` route redirecting to GitHub's OAuth authorize URL with a cryptographically random `state` parameter (stored server-side, tied to the pending login) and a PKCE `code_verifier`/`code_challenge` pair (even though GitHub's OAuth Apps don't require PKCE, generating and checking it costs little and matches current best practice — skip only if using a GitHub App flow instead, which has its own token exchange).
- `/auth/github/callback` route that **verifies `state` matches before doing anything else** (reject the callback if it doesn't — this is the CSRF protection the flow depends on), then exchanges the code, upserts the `users` row, creates a `sessions` row, sets an httpOnly session cookie.
- `src/hooks.server.ts` reading the session cookie on every request, attaching `event.locals.user`.
- `/auth/logout` clearing the session.
- Header shows "Sign in with GitHub" when logged out, avatar + username + "Log out" when logged in.

**Acceptance criteria:** full login → `state` verified → cookie set → `locals.user` populated → logout round trip works against a real GitHub OAuth App (or GitHub App) in dev; a callback with a missing or mismatched `state` is rejected.

---

## Phase 3 — Import & parsing

**Goal:** import a real repo (GitHub URL or ZIP/folder upload) and have it parsed into structured rows, matching the original prototype's language support and filtering exactly.

**Database:**
```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  source text not null,            -- 'github' | 'upload'
  github_owner text, github_repo text, github_branch text,
  status text not null default 'pending',  -- pending|cloning|parsing|ready|error
  error_message text,
  created_at timestamptz not null default now()
);

create table parsed_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  lang text not null,              -- java|js|ts|py
  loc int not null,
  is_test boolean not null default false,
  content text,                    -- read/write only through src/lib/server/fileStorage.ts
  unique (project_id, path)        -- idempotency: a retry's upsert can't duplicate a row for the same file
);
create table parsed_edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  from_file_id uuid not null references parsed_files(id) on delete cascade,
  to_file_id uuid not null references parsed_files(id) on delete cascade,
  unique (project_id, from_file_id, to_file_id)   -- same reason, for edges
);
create index on parsed_files(project_id);
create index on parsed_edges(project_id);
```

**Tasks:**
- `workers/parse_worker.py` — the parser is **Python**, not TypeScript, using **py-tree-sitter** with one grammar per language (`tree-sitter-java`, `tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-python`) to extract: import/require statements (JS/TS), `import`/`from...import` (Python), `package`+`import` (Java), and line counts. This is what `pytest` in the testing stack actually tests (fixes the mismatch where the README listed PyTest for parsing but the plan described TS parsers) and is a clean fit for the `enqueueParseJob()` seam below, since that boundary never cared what language sits behind it. This replaces the original prototype's regex-based `parseFile` (see `repograph-spec.md` §6) with real AST parsing — keep the same *resolution* logic (specifier → file path matching rules in §6) since that part doesn't need an AST, and can live in Python too, called from Phase 4's TS graph-analysis layer via the worker's output rows rather than being duplicated in two languages.
- Reuse exactly: the ignore-list, extension map, size cap, and test-path/entry-point rules from `repograph-spec.md` §5.1.
- **Upload/clone security — required, not optional:**
  - **Zip-slip protection:** when unzipping an uploaded archive, reject or sanitize any entry path containing `..`, an absolute path, or a symlink target outside the extraction directory, before writing anything to disk.
  - **Decompression limits:** cap total decompressed size (e.g. 200MB) and total file count (e.g. 20,000) while extracting, aborting the import with a clear error if exceeded — don't trust the archive's own size header, check as you go.
  - **GitHub clone limits:** a shallow clone (`--depth 1`) with the same size/file-count caps enforced after clone, before parsing starts.
  - **Cleanup & retention:** delete the extracted/cloned working directory as soon as parsing finishes (success or failure) — only `parsed_files.content` in Postgres persists, not a lingering copy on disk. Decide and document a retention policy for `parsed_files.content` itself (e.g. deleted when the project is deleted, per the existing `on delete cascade`).
  - **Authorization on every endpoint:** every route under `/api/projects/:id/*` (status, graph, chat, and anything added in later phases) must check `project.owner_id === locals.user.id` before reading or writing anything — add this as a single `requireProjectOwner(event, projectId)` helper used by every one of these routes, not re-checked ad hoc per route.
**Additional database — a durable job table (the "poor man's queue"):**
```sql
create table parse_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'pending',   -- pending|processing|done|failed
  claimed_at timestamptz,
  attempts int not null default 0,          -- bumped on each claim; past max_attempts, fail visibly instead of retrying forever
  error_message text,
  created_at timestamptz not null default now()
);
create index on parse_jobs(status, created_at);  -- the polling query's WHERE+ORDER BY, unindexed = a full scan once jobs accumulate
```
**Retention:** `parse_jobs` rows are an operational log, not data the app reads back — prune `done`/`failed` rows older than 30 days with a periodic cleanup query (a cron entry or a line in `worker_loop.py`'s own loop is enough; no separate job system needed for this). Rows for a deleted project are already removed via the existing `on delete cascade`.

- `/api/projects` POST — **in one database transaction**, insert the `projects` row and its `parse_jobs` row together, then commit and return `project.id`. Don't insert the project, then separately insert the job — if the second insert fails (connection drop, constraint error, anything), a non-transactional version leaves a `projects` row that's permanently stuck `pending` with no job ever created to move it forward. One transaction means either both exist or neither does.
- `workers/worker_loop.py` — **one long-running Python process**, started independently of the SvelteKit app (its own `npm run worker` / systemd unit / Docker service, kept alive by a process supervisor or restart policy), that loops:
  1. **Claim** the oldest eligible row: `UPDATE parse_jobs SET status='processing', claimed_at=now(), attempts=attempts+1 WHERE id = (SELECT id FROM parse_jobs WHERE status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.
  2. **Before parsing, clear any partial data from a previous attempt on this project**: `DELETE FROM parsed_files WHERE project_id = $1` (cascades to `parsed_edges`). This, plus running the whole parse — every `parsed_files`/`parsed_edges` insert for this job — **inside one database transaction that only commits once parsing fully succeeds**, is what makes a retry idempotent: a crash mid-parse means the transaction never committed, so the delete-and-reinsert on retry starts from a clean slate rather than appending onto whatever the crashed attempt managed to write. (The `unique (project_id, path)` / `unique (project_id, from_file_id, to_file_id)` constraints from the schema above are defense-in-depth on top of this — they turn a logic bug into a loud constraint-violation error instead of a silent duplicate row, they don't replace the clear-and-recommit design.)
  3. On success: commit the transaction, set `status='done'`, update `projects.status='ready'`.
  4. On failure (exception during parsing): roll back the transaction (so no partial rows persist either way), and if `attempts >= max_attempts` (e.g. 3), set `status='failed'` with `error_message` and `projects.status='error'` — a **visible, terminal failure**, not a silent retry loop; if under the limit, set `status='pending'` again so it's retried.
- **Stale-claim recovery — handles a hung worker, not just a crashed one.** A job stuck `processing` because the worker is wedged (not crashed, not restarted) needs its own check, separate from the startup reset below: at the top of every loop iteration (or on a short timer, e.g. every 60s), run `UPDATE parse_jobs SET status='pending' WHERE status='processing' AND claimed_at < now() - interval '15 minutes'` (choose a timeout comfortably longer than your largest expected repo takes to parse) — if a single process is also the one that could be the hung one, run this check from a second lightweight watchdog process (or have the main deploy run two worker replicas so one can reclaim the other's stale job; either is fine for an MVP, just don't rely solely on the one loop that might itself be the thing that's stuck).
- **Startup crash recovery** (distinct from the stale-claim timeout above): on `worker_loop.py` startup, reset any row still `status='processing'` back to `'pending'` unconditionally — a fresh process starting up means whatever it inherited mid-flight was orphaned by the previous run's crash, regardless of how long ago `claimed_at` was.
- **Scalability seam:** wrap the enqueue step as one function, `enqueueParseJob(projectId, tx)` in `src/lib/server/jobs.ts` — taking the active transaction so it composes with the `/api/projects` route's single-transaction insert above — so the route never writes to `parse_jobs` directly. Its Phase-3 body is the `INSERT` within that transaction; when Redis/BullMQ is added later (see `README.md`'s scaling table), only this function's body changes to `queue.add('parse', { projectId })` (and the project-creation transaction no longer needs to include it) — the route's call site doesn't change.
- `packages/analysis` (the TS graph-analysis layer, Phase 4) must have zero SvelteKit imports — pure functions taking file/edge data in, returning results out. This is what lets it be lifted behind a separate service later without a rewrite, per `README.md`'s "Designing for the scaling roadmap" table.
- Read/write file source text through one `src/lib/server/fileStorage.ts` module (`readContent(fileId)`/`writeContent(fileId, text)`) rather than inline Postgres column access, so storage can be swapped to blob storage later without touching callers.
- `/api/projects/:id/status` GET — poll endpoint for the import-progress UI (reuse the original's loading-overlay copy/behavior from `repograph-spec.md` §5.2/§18).
- **Landing-page copy fix — two occurrences, both must be replaced, not just the obvious one:** `repograph-spec.md` line 3 ("...entirely client-side — nothing is uploaded to a server...") and line 58, the landing lede itself ("...Nothing is uploaded."). Both describe the original *browser-only* prototype and are **false** for this hosted app, which uploads/clones and stores source on the server. When porting the landing page in this phase, replace both with accurate copy, e.g. "Your code is processed on our servers to build the visualizations and power chat, and never shared." `repograph-spec.md` itself stays unedited — it's a faithful record of the original prototype — but nothing in the *hosted app's* copy should repeat either claim. Grep for "uploaded" in whatever you port before considering this task done, in case a third occurrence was missed here too.

**Acceptance criteria:** importing a real small repo produces the correct file count, language breakdown, and import-edge count — spot-check a handful of known imports by hand. Importing the original prototype's own sample-fixture repo (if you've kept it) should produce the same cycle you know it has. A crafted zip with a `../../etc/passwd`-style entry is rejected, not extracted. An oversized archive is rejected mid-extraction, not after. `/api/projects` returns in well under a second regardless of repo size; status only reaches `ready` once the background worker actually finishes. Requesting another user's project ID on any `/api/projects/:id/*` route returns 403/404, not data. **Restart durability:** start an import, kill `worker_loop.py` mid-parse (simulating a crash or redeploy), restart it, and confirm the stuck `processing` row resets to `pending` on startup, the import completes, and **`parsed_files` has exactly one row per file — no duplicates from the first, interrupted attempt.** **Stale-claim recovery:** simulate a hung (not crashed) worker by manually setting a row to `processing` with an old `claimed_at` and confirm it's reclaimed without a restart. **Terminal failure:** force a project to fail parsing `max_attempts` times in a row and confirm it ends in a visible `projects.status='error'` with a message, not an infinite retry loop. **Atomic creation:** confirm a `projects` row is never observable without a matching `parse_jobs` row (hard to fault-inject directly, but code-review the route to confirm both inserts share one transaction).

---

## Phase 4 — Graph analysis

**Goal:** port the derivation algorithms so every later view has real data to render.

**Tasks:**
- `packages/analysis/graph/` — port `derive()` (fan-in/out), `tarjan()` (SCC/cycle detection), `bfsReach()` (blast radius), and `buildTree()` (path-hierarchy builder with single-child folder collapsing) from `repograph-spec.md` §7, operating on `parsed_files`/`parsed_edges` rows instead of the in-memory arrays the prototype used.
- `/api/projects/:id/graph` GET — returns the derived graph (nodes, edges, cycles, fan-in/out) as JSON for the frontend to render.
- Cache the derived result (don't recompute per request) — invalidate on re-import.

**Acceptance criteria:** write a unit test fixture with a known 3-file import cycle and known fan-in/out counts; `tarjan()` and `derive()` must reproduce them exactly (mirrors the original artifact's own cycle-detection test approach).

---

## Phase 5 — Core views: Tree, Size map, Dependencies

**Goal:** the three most structurally-similar views, interaction-complete.

**Tasks:**
- Svelte components under `src/lib/views/`: `Tree.svelte`, `Treemap.svelte`, `Graph.svelte`, each a port of `repograph-spec.md` §8/§9/§10 — same D3 primitives (hierarchy/tree, treemap, force simulation + custom `forceCluster`), same controls (detail slider, spacing, hide-unconnected, only-cycles, all-labels, blast-radius, cluster-by-folder for Dependencies; color-by dropdown + breadcrumbs for Size map; expand/collapse for Tree), same copy/hints.
- Toolbar tabs + language chips + search box (`repograph-spec.md` §15), wired to these three views first.
- `/workspace/[projectId]` route rendering the active view inside the Phase 1 layout.

**Acceptance criteria:** visually and behaviorally matches the original prototype for the same imported repo — same node count, same cycle highlighting, same blast-radius click behavior.

---

## Phase 6 — Architecture (UML) + ER Diagram

**Goal:** component/class diagrams and ORM entity diagrams.

**Tasks:**
- Extend `workers/parse_worker.py` (Python, same tree-sitter setup as Phase 3) to also extract: class/interface declarations with `extends`/`implements` per language, and ORM entity/relationship data for the four detection rules in `repograph-spec.md` §12 (JPA/Hibernate, TypeORM, Django, SQLAlchemy) — as tree-sitter queries, not regexes. Store results in two new tables (`parsed_types`, `parsed_entities`) written by the same worker run as Phase 3's parsing, not a separate pass.
- `/api/projects/:id/types` and `/api/projects/:id/entities` GET — serve the extracted data to the frontend.
- `src/lib/views/layout/layeredDag.ts` — port `layerNodes`/`computeLayerPositions` (`repograph-spec.md` §11) once, shared by both consumers below. This is layout/rendering only (TypeScript, in the frontend), not extraction.
- `Uml.svelte` — component diagram (folders grouped by detail level, layered by import depth) drilling into a per-package class diagram, rendering the `parsed_types` data above.
- `Er.svelte` — renders the `parsed_entities` data above with the same field/relationship/cardinality rendering as `repograph-spec.md` §12.

**Acceptance criteria:** a fixture repo with one JPA `@Entity` and one Java `extends` relationship renders both the correct class-diagram arrow and the correct ER box/relationship.

---

## Phase 7 — Hotspots + dead-code detection

**Goal:** the five-card ranked-list view.

**Tasks:**
- `Hotspots.svelte` — port the five cards verbatim from `repograph-spec.md` §13 (largest files, most imported, most dependent, import cycles with collapsible groups, possibly-unused).
- Dead-code rule — port §14 exactly (fan-in = 0, not a test, not an entry point, not referenced by any other type's `extends`/`implements` anywhere in the repo). Depends on Phase 6's type extraction existing first.

**Acceptance criteria:** a fixture base class only ever subclassed within its own package (no import needed) must **not** appear in "possibly unused" — this was a real bug in the original prototype's first pass; verify your port doesn't repeat it.

---

## Phase 8 — Side panel + global filters/search

**Goal:** the always-visible overview/details pane and working filters across all six views.

**Tasks:**
- `SidePanel.svelte` — port every state from `repograph-spec.md` §16 (no-selection overview, file-selected, folder-selected, entity-selected), wired to every view's click handlers.
- Finish wiring language chips, "hide tests", and search to all six views (Phase 5 only wired the first three).

**Acceptance criteria:** selecting a file in any of the six views updates the side panel correctly; toggling a language chip or the test filter updates every view's active node/edge set.

---

## Phase 9 — Persistence

**Goal:** reopen a previously-imported project without re-parsing.

**Tasks:**
- `/projects` route — "my projects" list (name, source, imported date, file count) querying `projects` by `owner_id`.
- `/workspace/[projectId]` loads from `parsed_files`/`parsed_edges` directly instead of requiring a fresh import.
- Delete-project action (cascades via the FK `on delete cascade` already in the Phase 3 schema).

**Acceptance criteria:** import a repo, navigate away, come back via `/projects`, and the workspace loads instantly from stored data with no re-parse.

---

## Phase 10 — Chat

**Goal:** working tool-calling chat with cost controls.

**Database:**
```sql
create table chat_usage (
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  message_count int not null default 0,
  primary key (user_id, date)
);
```

**Tasks:**
- Static UI first: `ChatPanel.svelte`, port verbatim from `repograph-spec.md` §17 — empty state, four starter-prompt chips, message bubbles, disabled input until ready.
- `/api/projects/:id/chat` POST — server route that:
  1. **Atomically reserves a quota slot before calling the model** — not check-then-increment, which lets concurrent requests all pass the check before any of them increment (two tabs open, or a double-click, can silently exceed the quota). Use a single statement that checks and increments together, e.g.:
     ```sql
     insert into chat_usage (user_id, date, message_count)
     values ($1, current_date, 1)
     on conflict (user_id, date)
     do update set message_count = chat_usage.message_count + 1
       where chat_usage.message_count < $2   -- $2 = CHAT_DAILY_QUOTA
     returning message_count;
     ```
     Zero rows returned means the quota was already hit — reject the request before calling the model. This reserves the slot whether or not the model call later succeeds.
  2. **On a failed model call (timeout, API error, etc.), release the reserved slot** — decrement `message_count` back down in a follow-up statement, so a failure doesn't cost the user's quota. A successful response simply leaves the already-incremented count as-is (no separate increment step at the end).
  3. Builds the context block using the **exact system/context prompt** from `repograph-spec.md` §17 (repo totals, language breakdown, top-level structure, largest files, most-imported files, cycles, tool descriptions, the regex-based-imports caveat line).
  4. Calls the Anthropic API with `cache_control` on the system/context block (prompt caching — this block is identical on every message in a session, so only the first call in a session should pay full price for it).
  5. Implements the three tools against Phase 3/4's real data: `getFile(path)` (22k-char truncation cap, fuzzy-suggestion fallback on miss), `searchFiles(query)`, `listChildren(path)`.
- Chat always reads the **full, unfiltered** parsed project — do not apply the view-level language/test filters to what the tools can see (this is intentional, matching the original: see `repograph-spec.md` §17's "chat sees the whole repo, unfiltered" note).
- **Scalability seam:** define the tool list as one array (`src/lib/server/chat/tools.ts`) that the API call reads from, not three separate hardcoded branches in the request body. This is what makes a future fourth tool (`semanticSearch`, once semantic search is actually built — see `README.md`'s scaling roadmap) an addition to the array rather than a rework of the chat route.
- **Scalability seam:** implement the reserve/release logic above as two functions, `reserveQuota(userId)` and `releaseQuota(userId)`, in `src/lib/server/quota.ts` — the chat route calls only these two functions, never the table directly, so a later swap to a Redis-based counter (for higher-volume, lower-latency checks) touches only this one file; the atomicity requirement carries over to whatever backs it.

**Acceptance criteria:** ask a question that requires a real tool call (e.g. "what does the largest file do?") and confirm the model actually calls `getFile` rather than guessing; fire several concurrent chat requests near the quota limit and confirm the count never exceeds `CHAT_DAILY_QUOTA`; confirm a forced model-call failure releases the reserved slot instead of burning it; confirm a second message in the same session shows a cache-hit in the Anthropic API response usage data.

---

## Phase 11 — Usage/account UI

**Goal:** users can see their plan and usage.

**Tasks:**
- `/account` route — plan name, today's chat usage vs. quota (progress bar), "Upgrade" button (stubbed — no charge yet).

**Acceptance criteria:** usage bar reflects real `chat_usage` rows and updates after sending a chat message.

---

## Phase 12 — Billing

**Goal:** real payment, only once you're ready to charge.

**Database:**
```sql
create table plans (
  id text primary key,              -- 'free' | 'pro'
  chat_daily_quota int not null,
  price_cents int not null
);
alter table users add column plan_id text not null default 'free' references plans(id);
alter table users add column stripe_customer_id text;
```

**Tasks:**
- Stripe Checkout session for the "Upgrade" button; `/api/stripe/webhook` handling `checkout.session.completed` and subscription-cancellation events, updating `users.plan_id`.
- Replace the hardcoded `CHAT_DAILY_QUOTA` env var with a lookup against `plans.chat_daily_quota` by the user's `plan_id`.

**Acceptance criteria:** Stripe test-mode checkout correctly upgrades a user and raises their effective quota.

---

## Phase 13 — Hardening & deploy

**Goal:** ship it.

**Tasks:**
- Full Playwright e2e suite: GitHub login → import → all six views → chat → logout.
- Empty/error states for every view (no files match filter, no classes in package, no entities detected, import failed) per `repograph-spec.md` §18.
- Responsive pass at the 900px breakpoint (§3).
- Production deploy of **two persistent processes**, not a pure edge/serverless target for either: the SvelteKit app (Node) and `workers/worker_loop.py` (Python, long-running, its own supervised process/service — py-tree-sitter needs native bindings and the worker needs to stay alive to keep polling `parse_jobs`, not run per-request). Managed Postgres; environment secrets configured for both processes.

**Acceptance criteria:** the full Playwright suite passes against a deployed staging URL.
