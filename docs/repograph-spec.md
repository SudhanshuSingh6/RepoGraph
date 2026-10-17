# Repograph — Build Specification

Build a single-page web app called **Repograph**: "see how a codebase fits together." It ingests a local Java/JavaScript/TypeScript/Python codebase (folder picker, drag-and-drop, or a GitHub repo ZIP) entirely client-side — nothing is uploaded to a server — and renders it from six different angles (Tree, Size map, Dependencies, Architecture, ER Diagram, Hotspots), with a persistent overview/details panel on the left and an AI chat panel on the right, always visible alongside whichever view is selected in the center.

Build this as a **single self-contained HTML file** (inline CSS + JS), using **D3.js v7** for every visualization (force simulation, treemap, custom SVG dendrograms, UML-style box diagrams) and **JSZip** for unzip support. No build step, no framework, no backend for the core app — only the chat feature needs an LLM call (see "Chat panel" below for how to adapt it outside a Claude Artifact).

## 1. Tech stack

- Plain HTML + CSS + vanilla JS (`'use strict'`), one `<script>` block, no modules/bundler.
- `d3.js` 7.9.0 from cdnjs.
- `jszip.min.js` 3.10.1 from cdnjs.
- Google Fonts: **Bricolage Grotesque** (display/headings, weights 500/700), **Instrument Sans** (body/UI), **JetBrains Mono** (code/paths/numbers).
- `<input type="file" webkitdirectory directory multiple>` for folder picking; drag-and-drop via `DataTransferItem.webkitGetAsEntry()`; a separate hidden `<input type="file" accept=".zip">` for ZIP import.

## 2. Design tokens

CSS custom properties on `:root`, with a dark-mode variant via `prefers-color-scheme` (overridable with `data-theme="light"`/`"dark"` on `:root`):

```
Light: --bg:#e3ecea --panel:#f4f8f7 --panel2:#e8f0ee --ink:#0e2b33 --muted:#557077
       --line:#c1d2cf --accent:#d81e6f --blast:#c8660a --neutral:#b9cac8
       --folder:rgba(14,43,51,.045) --edge:rgba(14,43,51,.34) --grid:rgba(14,43,51,.06)
Dark:  --bg:#0a1a20 --panel:#10252d --panel2:#153039 --ink:#dcebe8 --muted:#86a1a6
       --line:#22414a --accent:#ff4d94 --blast:#ff9d42 --neutral:#2f4e56
       --folder:rgba(220,235,232,.045) --edge:rgba(220,235,232,.34) --grid:rgba(220,235,232,.05)
```

Language colors (used throughout, including the landing-page hero SVG): Java `#e08a2c`, JavaScript `#e5c92f`, TypeScript `#3c82d6`, Python `#38a67a`.

`--accent` (magenta/pink) marks circular imports everywhere; `--blast` (orange) marks blast-radius highlighting. Base font 14px/1.5, `box-sizing:border-box` globally, safe-area insets on body padding for notched devices. Reduced-motion media query disables all transitions/animations.

## 3. Page layout

```
<div class="app">  (flex column, 100% height)
  <header class="top">  — brand mark + wordmark "Repograph", repo stats (hidden until a repo is loaded),
                           "Load sample project" / "Choose folder" buttons, right-aligned
  <section class="landing">  — shown until a repo is loaded
  <section class="workspace" hidden>  — shown after a repo is loaded
    <div class="toolbar">  — view tabs, legend chips, search box
    <div class="ctl">  — per-view context controls (changes contents per active view)
    <div class="main">  — CSS grid: 300px (side panel) | 1fr (stage) | 380px (chat panel)
      <aside class="side">     — always-visible overview/details
      <div class="stage">      — the active view renders here
      <div class="chat-panel"> — always-visible chat
</div>
```

Brand mark: a small inline SVG — three dots (blue/yellow/green/orange, 3.6r circles) connected by two lines, suggesting a tiny dependency graph, next to the wordmark "Repograph" in Bricolage Grotesque 700 20px.

**Responsive (≤900px):** landing collapses to a single column (hero image moves above the text); the 3-column workspace grid becomes a vertical stack (`.stage` 62vh, `.side` below it, `.chat-panel` 60vh below that), search box goes full-width, and all but the first three header stats are hidden.

## 4. Landing page

Two-column hero (grid `1.05fr / .95fr`) on a faint dot-grid background (`--grid` 32px squares):

- **H1** (Bricolage Grotesque 700, clamp 2.2–3.7rem): "Drop in a codebase and see how it fits together."
- **Lede**: "Repograph reads Java, JavaScript, TypeScript and Python folders right in your browser and maps them from every angle. Nothing is uploaded."
- **Drop zone** (`.sheet`): a dashed-border card with corner-bracket decorations (CSS `linear-gradient` corner marks, 16px, drawn in `--ink`, turning `--accent` while `body.dragging`) containing:
  - "Drag a project folder onto this page, or pick one."
  - Buttons: **Choose folder** (primary) and **Try the sample project**.
  - Fine print: "Folders like node_modules, .git, build, dist and venv are skipped automatically."
  - A GitHub-import sub-section (divided by a dashed top border): label "Or import from GitHub", a text input (placeholder `github.com/owner/repo`) + a short branch input (placeholder `branch`) + **Get ZIP** button, and fine print explaining the flow (see §6.3).
  - An error line (`.err`, `--accent` colored), hidden by default.
- **View legend** (`<dl class="views">`): one row per view — term = view name, definition = one-line description. Exact copy:
  - **Tree** — "The whole codebase as a node-and-line tree diagram. Click a folder to expand or collapse it."
  - **Size map** — "Every file as a rectangle sized by line count. Click a folder to zoom in."
  - **Dependencies** — "Which files or folders import which. Circular imports are drawn in magenta."
  - **Architecture** — "A UML-style component diagram, arranged in layers, with a class diagram for any package."
  - **ER Diagram** — "Database entities and relationships, detected from JPA, Django, SQLAlchemy or TypeORM code."
  - **Hotspots** — "The biggest files, the most-imported files, and every import cycle."
- Closing fine print: "A summary of the repo stays on the left and a chat panel stays on the right — whichever view you pick loads in the middle."
- Right column: a procedurally-drawn example dependency graph, generated at load time from a fixed point/edge list (not a static image) — 13 nodes at hand-placed `[x,y,radius,lang]` coordinates in a 420×320 viewBox, colored by language, connected by 15 directed edges (arrowhead markers, radius-aware endpoints so lines stop at each circle's edge rather than its center), with edges `5→6, 6→7, 7→5` drawn thicker and in `--accent` as the one highlighted cycle. Caption: "Circles are files, arrows are imports. The three magenta arrows form an import cycle." (Reproduce the generator function, not a fixed SVG — it's ~10 lines of JS building marker defs + lines + circles from the two arrays.)

## 5. Ingestion pipeline

### 5.1 Supported languages & filtering
- Extension → language map: `java`→java; `js,jsx,mjs,cjs`→js; `ts,tsx,mts,cts`→ts; `py`→py.
- Ignore-list of directory names skipped anywhere in the path: `node_modules, .git, .hg, .svn, dist, build, out, target, __pycache__, .venv, venv, .tox, .mypy_cache, .pytest_cache, .ruff_cache, .idea, .vscode, coverage, .next, .nuxt, .gradle, .mvn, bower_components, site-packages, .cache, .turbo, .angular, .svelte-kit`.
- Also excluded: `*.d.ts`/`*.d.mts`/`*.d.cts`, `*.min.js` (and `.mjs`/`.cjs` variants), `*.bundle.js`.
- Per-file size cap: 1,500,000 bytes — oversized files are counted but not read.
- Test-file detection regex (used for the "hide tests" filter and dead-code exclusion): paths under `tests?/__tests__/specs?/e2e/__mocks__/`, files matching `*.test.*`/`*.spec.*`, Python `test_*.py`/`*_test.py`/`conftest.py`, `src/test/`, or Java `*Test.java`/`*Tests.java`/`*IT.java`.
- Entry-point heuristic (excludes a file from "possibly unused"): basename matches `index|main|__init__|__main__|app|application|wsgi|asgi|manage|setup|conftest` (any of the four languages' extensions), or `*Application.java`, or a Python file containing `if __name__ == "__main__"`.

### 5.2 Loading a folder
- Folder picker and drag-and-drop both resolve to a flat list of `{path, file}` via `webkitGetAsEntry`/`webkitdirectory`, filtered by `keepPath()` (ignore-list + extension check) before reading.
- Files are read with a small worker pool (8 concurrent `file.text()` calls) with a progress overlay (`.loading`: message + animated progress bar) updating every 20 files.
- A sample project (small fixture repo demonstrating all 4 languages, with at least one intentional import cycle and one ORM entity) ships inline so "Try the sample project" works offline.

### 5.3 GitHub import
- `parseGithubUrl(raw)` accepts `owner/repo`, `github.com/owner/repo`, a full `https://github.com/owner/repo` URL, a `git@github.com:owner/repo.git` SSH URL, or a URL with a `/tree/<branch>/...` or `/blob/<branch>/...` suffix (branch captured, trailing path ignored). Regex: `^github\.com\/([\w.-]+)\/([\w.-]+?)(?:\/(?:tree|blob)\/([^/]+)(?:\/.*)?)?\/?$`.
- Because a published page can't `fetch()` a cross-origin ZIP, "Get ZIP" **opens** `https://github.com/<owner>/<repo>/archive/refs/heads/<branch or main>.zip` in a new tab (a real browser navigation, not an API call) and tells the user to drag that downloaded `.zip` back onto the page, or pick it with a dedicated "choose the .zip file" link. Mention in the UI: if the download 404s, the default branch probably isn't `main`.
- Dropped/picked `.zip` files are unzipped client-side with JSZip (`JSZip.loadAsync`); a common root folder (GitHub's `repo-branch/` wrapper) is stripped before the same ignore/extension filtering is applied.

## 6. Parsing & import resolution

Regex-based, not a real parser (fast, zero-dependency, "good enough" for a visual map).

- **JS/TS**: strip comments, then match `import ... from '...'`, bare `export ... from '...'`, `require('...')`, and dynamic `import('...')`, collecting the specifier set.
- **Python**: strip `#` comments; match `from <dots><module> import (...)` (capturing leading-dot relative-import depth, module path, and imported names) and plain `import a.b.c[, d.e]`.
- **Java**: strip comments; capture the `package` declaration and every `import [static] a.b.C[.*];`.
- Also extract per-file line count (non-blank lines).

**Resolving a specifier to a file index** (`linkFiles`):
- JS/TS: relative specifiers (`./`, `../`) are joined against the importing file's directory and matched against real paths trying each JS/TS extension and an `/index.<ext>` fallback. Bare specifiers (aliases like `@/x`, `~/x`, or bare `src/...`-style paths) are matched by path-suffix index, preferring the candidate whose directory shares the longest path-prefix with the importer.
- Python: absolute imports are resolved by progressively shortening dotted-path lookup against an index of every file's full dotted module path; relative imports (`from . import x`, `from ..pkg import y`) walk up the importer's directory by the dot count.
- Java: fully-qualified name lookup by `package.ClassName` index, falling back to shortening the qualified name; wildcard imports (`import pkg.*`) expand to every class in that package (capped at 8, to avoid false positives on large packages).
- Only intra-repo imports resolve to edges; external/library imports are silently dropped (they produce no node).

## 7. Graph derivation (recomputed on every filter change, via `refresh()`)

- Build forward adjacency (`adj`) and reverse adjacency (`rev`) arrays, fan-in/fan-out counts, from each active file's resolved `deps`.
- **Tarjan's strongly-connected-components** algorithm (iterative, not recursive, to avoid stack overflow on large repos) finds import cycles; any SCC with >1 member is a "cycle group", sorted largest-first.
- **Blast radius**: plain BFS over forward or reverse adjacency from a chosen node, returning the full transitive reachability set (used for "what does this affect" / "what does this depend on").
- A hierarchical **tree** is built from file paths (folders collapse into their single child when they have exactly one, like a compressed trie), aggregating per-node: total LOC, file count, dominant language, max fan-in/out among descendants, cycle-file count — this both drives the Tree view and the Size-map treemap.
- "Grouping levels" for the Dependencies/Architecture views: `S.levels = [1, 2, ..., maxDirDepth, Infinity]` (Infinity = ungrouped, one node per file). Default group depth auto-picks the coarsest level that keeps ≤120 groups when there are >60 files (so large repos start grouped, small ones start per-file).

## 8. View: Tree

An actual D3 node-link **dendrogram** (`d3.hierarchy` + `d3.tree()`), not an indented list — circles for nodes, curved lines for parent-child edges, SVG pan/zoom (scroll to zoom, drag to pan). Folder nodes are clickable to expand/collapse (state kept per-path in `S.treeExpanded`); file nodes are clickable to select (updates the side panel). Toolbar controls: "Expand all" / "Collapse all" buttons. Node label color highlights on hover; selected node is accent-colored and bold.

## 9. View: Size map (treemap)

D3 `d3.treemap()` over the same hierarchical tree, rectangle area ∝ line count. Folder rectangles are outlined boxes with a top-left label; file/block rectangles are solid, with a diagonal-hatch texture reserved for a "block" sub-type. Clicking a folder zooms into it (updates `S.tmPath`, shown as clickable breadcrumbs in the control bar); clicking a file selects it. A **Color by** dropdown switches fill color between: Language, Times imported (fan-in, light-teal→dark-teal sequential scale), Imports made (fan-out, cream→burnt-orange sequential scale), Import cycles (accent vs neutral). A floating legend (bottom-left) shows the active color mapping. Selected rectangle gets a thick accent outline; non-matching search results dim to 20% opacity.

## 10. View: Dependencies (force-directed import graph)

D3 force simulation (`forceManyBody`, `forceLink`, `forceCollide`, plus a **custom multi-foci `forceCluster`** that each tick pulls every node toward its own cluster's live centroid — the classic clustering-force pattern) rendered as circles (radius ∝ LOC) and curved directed edges with arrowheads. Cycle edges/nodes render in `--accent`; everything else in `--edge`/language color.

Toolbar controls (`.ctl`):
- **Detail** slider — walks `S.levels`, grouping files into folder-nodes at the chosen depth (or ungrouped at the max).
- **Spacing** slider (0.6×–3.0×) — scales link distance.
- **Hide unconnected** checkbox (default on) — drops isolated nodes.
- **Only cycles** checkbox — shows only nodes/edges that participate in an import cycle.
- **All labels** checkbox — forces every node's label visible (otherwise only on hover/selection).
- **Blast radius** checkbox — when on, clicking a node highlights (in `--blast` orange) every node transitively reachable from it (its full forward blast radius) and dims the rest.
- **Cluster by folder** checkbox (default on) — toggles the custom clustering force so same-folder nodes visually group.
- Legend (bottom-left floating): per-language color key, an "import" line sample, a "circular import" accent line sample, "circle size shows lines", and (when blast-radius mode is on) a hint dot.
- Hovering a node highlights its direct edges/neighbors; hovering an edge traces it.

## 11. View: Architecture (UML)

Two linked sub-views sharing the `uml` tab:

**Component diagram** (`renderUmlComponents`, shown by default): one box per folder/package (grouped at a **Detail** level, same slider pattern as Dependencies, auto-picked so groups ≤20 by default) arranged in **layers** via a custom layered-DAG layout (`layerNodes` buckets nodes by longest-path depth from sources; `computeLayerPositions` assigns x/y within each layer row, minimizing crossings — essentially a simplified Sugiyama layout), connected by import-dependency edges. Clicking a package box opens its **class diagram**.

**Class diagram** (`renderUmlClasses(folderKey)`): for the files in one package, extract class/interface declarations per language —
- Java: `class|interface|enum|record NAME [extends X] [implements Y, Z]` (also detects `abstract class`).
- JS/TS: `class NAME [extends X] [implements Y]` and `interface NAME [extends Y, Z]`.
- Python: `class NAME(Base1, Base2):` (filters out `object` and keyword args).

Each type renders as a UML-style box (stereotype italic label, bold title, mono subtitle) with a solid arrow for `extends` and a dashed arrow for `implements`, laid out with the same layered algorithm. Breadcrumb control bar shows "`<repo> / <package>`" with a back button; hint text: "Solid arrow = extends, dashed = implements." An empty state (`.uml-empty`) explains when no classes were found in a package.

## 12. View: ER Diagram

Detects ORM entities via regex per language and renders them as UML-style **field-list boxes** (primary-key fields bolded, "+N more" truncation for long field lists) connected by relationship edges labeled with cardinality (1–1, 1–N, N–1, N–N), laid out with the same layered-DAG positioning. Detection rules:

- **JPA/Hibernate (Java)**: classes annotated `@Entity`; `@Id`/`@Column` fields (with type + name); `@Table(name=...)` for the display table name; `@OneToMany/@ManyToOne/@OneToOne/@ManyToMany` fields for relationships (target type taken from the generic/collection type).
- **TypeORM (TS/JS)**: `@Entity()` classes; `@PrimaryColumn`/`@PrimaryGeneratedColumn` and `@Column` fields (TS type annotations); `@OneToMany(() => Target)`-style relationship decorators.
- **Django**: classes extending `models.Model`; each `field = models.Type(...)` becomes a column (auto-adds an implicit `id` PK if none declared); `ForeignKey`/`OneToOneField`/`ManyToManyField` become relationships, target model name parsed from the first positional/`to=` argument (`self` resolves to the owning class).
- **SQLAlchemy**: classes with `__tablename__` or extending `db.Model`; `col = Column(...)` fields (type + `primary_key=True` detection); `rel = relationship("Target")` becomes a generic "RelatedTo" relationship.

Control-bar hint: "Click an entity to inspect its fields and relationships. Detected from JPA/Hibernate, Django, SQLAlchemy and TypeORM code." Empty state shown when no entities are detected.

## 13. View: Hotspots

A responsive card grid (`auto-fit, minmax(310px,1fr)`), no canvas — five `<section>` cards, each a scrollable ranked list (click any row to select that file and update the side panel):

1. **Largest files** — top 12 by LOC.
2. **Most imported** — top 12 by fan-in (files where a change has the widest blast radius).
3. **Most dependent** — top 12 by fan-out.
4. **Import cycles** — every SCC with >1 member, as collapsible `<details>` (summary = file count + first 3 basenames + "and more"), each expandable to the full member list (capped at 25 shown, "and N more"), with a "view in graph" link that jumps to the Dependencies view with that cycle's first member selected.
5. **Possibly unused** ("dead code") — see §14 below, sorted by fan-out among the candidates, top 12.

Each card has a one-line explanatory subtitle under its heading (exact copy is part of spec, see source above).

## 14. Dead-code detection

A file is a "possibly unused" candidate only if **all** of: it's active (passes current filters), `fanIn === 0`, it is not a test file, it does not look like an entry point (§5.1), **and** no other file's class/interface declaration anywhere in the repo `extends` or `implements` a type this file defines (cross-referenced against the same type-extraction used for the UML class diagram — this avoids flagging base classes/interfaces that are only ever subclassed within the same package and thus need no `import`). List copy includes the caveat: "They may still be used dynamically, loaded by a framework, called from outside this codebase, or be a public API — check before deleting."

## 15. Toolbar & global controls

- **Tabs** (`role=tablist`): Tree · Size map · Dependencies · Architecture · ER Diagram · Hotspots — one active (`aria-selected`), dark pill background when selected.
- **Language chips**: one pill per language present in the loaded repo, colored by language, showing a count; click toggles that language on/off (unpressed chips dim to 50% opacity and lose their fill) — drives `S.langOn` and triggers `refresh()`.
- **Search box** (right-aligned): live substring filter over file paths; matching nodes/rows stay full-opacity, non-matching dim (handled per-view: `.dim` class at 20%/14%/28% opacity depending on view).
- A **Hide tests** toggle is part of the filter state (`S.hideTests`) alongside language chips (exposed in the chips row or an adjacent control — wire it the same way as a language chip).
- Below the toolbar, a **per-view control bar** (`.ctl`, light `--panel2` background) swaps its contents based on the active tab — see each view's section above for its exact controls. Every view's control bar ends with a short italic `.hint` describing the primary interaction (e.g. "Scroll to zoom, drag to pan...").

## 16. Side panel (always visible, left)

Context-sensitive overview/details pane (`aria-live="polite"` so screen readers announce updates):

- **No selection**: repo-wide overview — key stats (`<dl class="kv">` grid: files, lines, imports, cycle count, etc. — big Bricolage-Grotesque numbers, tabular-nums), a language breakdown bar (`.bar`, stacked color segments proportional to LOC share) with a legend list (`.lrow`, color dot + language + right-aligned LOC), and a clickable "overview card" grid (`.ovnav`) linking into interesting places (e.g. "N import cycles", "N unused files") that jump to the relevant view/selection.
- **File selected**: path (mono, word-break), language pill, LOC, fan-in/fan-out counts, cycle badge if applicable, and lists of "imports" and "imported by" (each row clickable to pivot selection to that file).
- **Folder/group selected**: aggregate stats for that subtree (file count, total LOC, dominant language breakdown) plus a scrollable list of its files.
- **Entity selected** (ER view): table name, field list (PK bolded), relationship list.
- A "Clear selection" affordance returns to the repo-wide overview.

## 17. Chat panel (always visible, right)

Header: "Ask the codebase". Below it, a scrollable message list and a bottom input row (auto-growing `<textarea>` + Send button, disabled until the model connection is confirmed available).

**Empty state**: a short intro plus a handful of clickable "starter prompt" chips that pre-fill the textarea with a useful first question (e.g. "What does this codebase do?", "Where would I add a new API endpoint?").

**Important: chat sees the whole repo, unfiltered.** All six visualizations operate on the current filtered view (`S.files` masked by `S.active`, respecting language chips and "hide tests"). Chat deliberately does **not** — it is built once at ingest time from a separate, never-refiltered derivation (`S.D_full`/`S.fullTree`/`S.fullStats`, computed once alongside `S.D`/`S.tree`/`S.stats` right after parsing, and never recomputed by `refresh()`). So toggling off a language or hiding tests changes what's drawn on screen but never changes what the assistant can see or search — it always reasons over every ingested file. Build this as two parallel derivation results from the same `derive()`/`buildTree()` functions: one filtered (feeds the views), one permanent (feeds chat), not one shared mutable structure.

**Context**: on first send, build a one-time context message (`buildChatContext()`) and prepend it to the conversation as a synthetic user turn, answered by a synthetic "Got it — I can see the codebase. What would you like to know?" assistant turn, so the model starts grounded without the user having to explain the repo. Use this exact system/context prompt structure (sections joined by blank lines):

```
You are a code-exploration assistant built into Repograph, a codebase-visualization
tool. Answer questions about the codebase the person has open right now, as a
knowledgeable colleague who has actually looked at the code, not a generic assistant.

Repository: <repo name>

Totals: <N> files, <N> lines, <N> resolved imports between files, <N> import cycles.

Languages: <Language: N lines across N files; ...>

Top-level structure (folder: files, lines):
<top 2 levels of folders by LOC, 10 per level, "... and N more folders" if truncated>

Largest files by line count:
<top 10 by LOC>

Most-imported files:
<top 10 by fan-in, "path — imported by N files">

Import cycles found:
<up to 8 cycles, "a -> b -> c -> (back to start)">

You have three tools. getFile(path): returns a file's full source plus what it
imports and what imports it — use it before describing what any specific file does.
searchFiles(query): finds file paths containing a substring, when you are not sure
of an exact path. listChildren(path): lists the immediate files and subfolders under
a folder path ("" for the repository root) — use it to explore structure beyond the
summary above. Call these whenever a question needs real code, not just the summary;
do not guess at file contents.

Imports above were found by reading source text with regular expressions, not by
compiling the project — dynamic, reflective, or unusually aliased imports may be
missing, so real coupling can be higher than shown.

Answer concisely in plain prose, and name exact file paths when relevant. No need
for a preamble like "Based on the codebase" — just answer.
```

Four starter-prompt chips, verbatim: "What does this codebase do, at a glance?", "Which file would be riskiest to change?", "Explain any import cycles and how to break them.", "Where should I start reading this code?"

**Tools** (agentic — the model can call these mid-conversation to read real source before answering):
- `getFile({path})` — returns the file's language, line count, its resolved imports and importers (by path), and up to 22,000 characters of its source (flagging `truncated` if cut); if the exact path isn't found, returns up to 10 path suggestions containing the basename instead of erroring.
- `searchFiles({query})` — case-insensitive substring match over all file paths; returns count + up to 50 matches with language/line count.
- `listChildren({path})` — lists immediate files and subfolders of a folder (`""` = repo root); folders report aggregate file count and line total.

**Rendering**: user messages right-aligned/dark bubble, assistant messages left-aligned/light bubble (error state gets an accent border/text color); markdown-lite support for fenced code blocks and inline code in assistant replies; an animated three-dot "typing" indicator while a response is in flight.

**Platform note for a standalone rebuild**: the original app runs as a published Claude Artifact and gets its model access for free via the artifact-hosting platform's built-in `window.claude.use('sample')` capability (checked on load; chat is disabled with a "currently unavailable" status if that capability isn't present). **A standalone app built outside that environment has no such API** — wire the same tool-calling conversation loop (context message, the three tools above, streaming or non-streaming) against a real LLM API (e.g. the Anthropic Messages API) from a small backend that holds the API key, since a browser-only app can't safely hold a secret key. Keep the three tools, the context-priming turn, and the UI exactly as described; only the transport changes.

## 18. Misc UX details

- A floating tooltip (`.tip`, dark background, follows cursor, clamped to viewport) shows extra detail on hover in the graph/treemap/tree views (path, language, LOC, fan-in/out).
- A full-screen loading overlay with a message + progress bar appears during folder reads and ZIP extraction.
- Header repo-stats bar shows file count, total lines, and total import-edge count once a repo is loaded, with a "warn" (accent-colored) style reserved for drawing attention to a concerning number (e.g. many cycles). When one or more files exceeded the 1.5MB read cap during ingest, an extra stat chip appears: "N large file(s) skipped" (singular/plural copy), computed once at ingest and never cleared.
- Clicking "Choose folder" / "Load sample project" in the header works identically to the landing-page buttons once a workspace is already open (lets the user swap repos without reloading the page).
- Keyboard: `:focus-visible` gets a 2px accent outline everywhere (don't suppress default focus styling).

## 19. Build phases

Build and verify in this order — each phase produces something runnable before the next one starts, and later phases assume the data structures built in earlier ones (`S.files`, `S.D`, `S.tree`) already exist.

**Phase 1 — Shell, design tokens, landing page (no logic)**
Static HTML/CSS only: `:root` tokens + dark mode, fonts, the `.app` layout skeleton, header with brand mark, the full landing page (hero copy, drop-zone card with corner brackets, view-legend `<dl>`, hero SVG graph illustration). Buttons wired to `console.log` stubs. Ship this before writing any parsing code — it's the easiest thing to get pixel-right early and everything else builds inside the `.workspace` section it already reserves.

**Phase 2 — Ingestion pipeline**
Folder picker + `webkitdirectory`, drag-and-drop via `webkitGetAsEntry`, the ignore-list/extension filter (`keepPath`), the worker-pool file reader with the loading overlay, and the inline sample-project fixture (small, hand-written, hits all 4 languages + one cycle + one ORM entity). Stop here and confirm: picking the sample project populates `S.files` and flips `.landing`→hidden / `.workspace`→visible, header stats show a file count. GitHub ZIP import (open-in-new-tab + JSZip unzip + common-root stripping) can be built in this phase too, as a second entry point into the same `S.files` pipeline.

**Phase 3 — Parsing, import resolution, graph derivation**
`parseFile` (regex extraction per language), `linkFiles` (specifier→file-index resolution), `derive` (fan-in/out, Tarjan SCC, cycles), `buildTree` (path hierarchy for the treemap/tree). No rendering yet — verify by logging `S.D.edges`, `S.D.cycles.length`, and a few resolved import paths against the sample project's known-correct answers (you planted one cycle and know its members).

**Phase 4 — Toolbar, chips, search, side panel (overview only)**
Tabs, language chips (wired to `S.langOn`), search box, and `refresh()` recomputing stats on any filter change. Side panel's no-selection overview state (stat grid, language bar, overview-card grid). This phase has no center-stage rendering yet, but every control that will later trigger `renderView()` already works end-to-end against real filter state.

**Phase 5 — Tree view + Size map**
`renderTree` (D3 hierarchy/tree dendrogram, expand/collapse state) and `renderTreemap` (D3 treemap, breadcrumb zoom, Color-by dropdown, legend). These share the Phase 3 tree data structure and are the simplest two views to get interaction-complete, so they're a good pair to build and demo together.

**Phase 6 — Dependencies view**
Force simulation, the custom `forceCluster`, all six controls (Detail, Spacing, Hide unconnected, Only cycles, All labels, Blast radius, Cluster by folder), blast-radius BFS-on-click, hover-to-trace edges. The most interaction-heavy view — budget the most time here.

**Phase 7 — Architecture (UML) + ER Diagram**
Shared layered-DAG layout (`layerNodes` + `computeLayerPositions`) built once, then two consumers: UML components→classes (with `extractTypes` and the breadcrumb drill-down), and ER entities (`extractEntities` per ORM style + relationship edges with cardinality labels). Build component/class diagrams first since ER reuses the same box/edge rendering primitives.

**Phase 8 — Hotspots + dead-code detection**
The five-card grid, all driven by data already computed in Phase 3 (largest/most-imported/most-dependent are just sorts; cycles are already in `S.D.cycles`). Dead-code detection is the one new rule (`deadCodeCandidates`, cross-referenced against `extractTypes` from Phase 7) — build it last in this phase since it depends on that function existing.

**Phase 9 — Side panel: selection states**
Extend the Phase 4 side panel with file-selected, folder/group-selected, and entity-selected states, and wire every view's click handlers to set `S.sel` and call `renderSide()`. Easiest done after Phases 5–7 exist, since you need real selections from every view to test against.

**Phase 10 — Chat panel**
Static UI first (empty state, starter-prompt chips, message bubbles, disabled input) — ship that without any model wired up. Then the three tools (`getFile`, `searchFiles`, `listChildren`) against the real `S.files`/`S.D`, the context-priming turn, and finally the model transport itself (swap in your backend call in place of the Claude-Artifact-only `window.claude.use('sample')`, per §17's platform note).

**Phase 11 — Responsive layout + polish pass**
900px breakpoint (stacked layout), tooltip positioning/clamping, focus-visible states, reduced-motion handling, empty/error states for every view (no files match filter, no classes in package, no entities detected), and a final pass reading every copy string in this spec against what's actually rendered.

## 20. Open decisions — not resolvable from the spec alone

Everything above is extracted directly from the working app, so it's as exact as the source makes possible. Four things genuinely aren't decidable without you:

1. **Chat transport.** The original has no backend — it rides the Claude-Artifact-only `window.claude.use('sample')` capability, which doesn't exist outside claude.ai. Rebuilt via Claude Code, chat needs an actual backend holding an API key (you don't want a browser shipping a secret key). Smallest version: one local Node/Express (or even a single serverless function) endpoint that takes the conversation + tool defs, calls the Anthropic Messages API with tool use enabled, and returns the result — the three tools (`getFile`/`searchFiles`/`listChildren`) still *execute in the browser* against `S.files`/`S.D_full` since that's where the source lives; only the model call itself needs a server hop. Decide: do you want this to require an API key from whoever runs it, or should chat be optional/skippable if none is configured (recommended — keep the rest of the app fully offline-capable, same as the original)?

2. **Single HTML file vs. a real project.** The spec (and the original) is one `<script>` block with no build step, which is *why* it's practical to get pixel-exact — a framework rewrite (React/Vite/etc.) would require re-deriving every behavior instead of transcribing it, and risks drifting from "exactly." Recommend staying single-file for the frontend, with only the new chat backend as a second file. Say so explicitly to Claude Code, or it may default to scaffolding a full app.

3. **Sample-project fixture.** The spec says the sample project must hit all 4 languages, one import cycle, and one ORM entity, but doesn't hand over the original's actual fixture file contents (I didn't extract them from the source — they're inline literal strings deep in the file and would cost a lot of context to pull verbatim for little benefit, since any fixture meeting those three constraints demonstrates the same features). If you want the *exact* original sample files byte-for-byte rather than an equivalent one Claude Code writes fresh, say so and I'll pull them out specifically.

4. **No large-repo guardrail exists in the original** — thousands of files will make the force-directed graph (Phase 6) slow or unreadable, and nothing warns the user. This isn't a gap in the spec, it's a real limitation of the app as built. Worth deciding now rather than after a rebuild surfaces it: leave it as-is (matches original exactly), or add a soft warning/auto-group threshold (a deviation from "exactly," but a reasonable one). I'd lean toward leaving it out of Phase 1–11 and treating it as an explicit Phase 12 addition if you want it, so the rebuild stays a faithful clone first.
