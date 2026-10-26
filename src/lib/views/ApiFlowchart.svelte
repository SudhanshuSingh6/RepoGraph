<script lang="ts">
	// One endpoint's control-flow chart: the handler's statements and structures, with
	// its calls opening inline (see packages/analysis/apis/cfg.ts for the semantics and
	// layout/flowchartLayout.ts for the drawing).
	import { refKey, type FnChart } from '#analysis/apis/flowchart.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import FlowchartFullscreen from './FlowchartFullscreen.svelte';
	import FlowchartSvg from './FlowchartSvg.svelte';
	import { opLabel } from '#analysis/apis/queries.ts';
	import { closedSummary, closedWords, layoutChart, queryFlags } from './layout/flowchartLayout.ts';

	let { ws, n, root }: { ws: Workspace; n: number; root: FnChart } = $props();

	const rootKey = $derived(`e${n}`);
	const scene = $derived(
		layoutChart(
			root,
			{
				chartOf: (ref) => ws.fnCharts.get(refKey(ref)),
				isOpen: (key, fallback) => ws.chartOpen.get(key) ?? fallback,
				chosen: (key) => ws.chartChoice.get(key) ?? 0,
				groupOpen: (key) => ws.chartGroups.has(key)
			},
			rootKey
		)
	);

	// Opened calls whose charts aren't here yet: fetch them.
	$effect(() => {
		for (const ref of scene.missing) ws.loadFn(ref);
	});

	const chips = $derived(
		scene.shapes.flatMap((s) => (s.type === 'box' ? s.calls : [])).filter((c) => c.expandable)
	);
	let expandingAll = $state(false);
	// After "Expand all": what it opened and what stayed closed, and why (kept up to date
	// as calls are toggled, until "Collapse all").
	let showSummary = $state(false);
	$effect(() => {
		// "Expand all" keeps opening newly revealed calls until nothing closed is left
		// (expandability stops it at the depth limit and at recursion).
		if (!expandingAll) return;
		const closed = chips.filter((c) => !c.open);
		if (!closed.length) {
			expandingAll = false;
			showSummary = true;
		}
		for (const c of closed) ws.chartOpen.set(c.key, true);
	});
	function collapseAll() {
		expandingAll = false;
		showSummary = false;
		for (const c of chips) ws.chartOpen.set(c.key, false);
	}
	const summary = $derived(
		showSummary
			? closedWords(closedSummary(scene.shapes.flatMap((s) => (s.type === 'box' ? s.calls : []))))
			: null
	);

	// Full screen: the overlay draws this same scene; closing returns focus to the button.
	let fullButton = $state<HTMLButtonElement>();
	const endpoint = $derived(ws.apis?.[n]);

	// Every query detected in the endpoint's traced flow (closed calls included).
	const detected = $derived.by(() => {
		const c = ws.apiCharts[n];
		return c && c !== 'loading' && 'queries' in c ? c.queries : null;
	});
</script>

<div class="chart">
	<div class="bar">
		<button type="button" class="btn" onclick={() => (expandingAll = true)}>Expand all calls</button
		>
		<button type="button" class="btn" onclick={collapseAll}>Collapse all calls</button>
		<button
			type="button"
			class="btn"
			bind:this={fullButton}
			aria-haspopup="dialog"
			onclick={() => (ws.chartFullscreen = n)}>Full screen ⤢</button
		>
		{#if summary}<span class="summary">{summary}</span>{/if}
	</div>
	<div class="scroll">
		<svg
			width={scene.width}
			height={scene.height}
			viewBox="0 0 {scene.width} {scene.height}"
			role="img"
			aria-label="Control-flow chart of {root.label}"
		>
			<FlowchartSvg {ws} {scene} marker="fc-arrow-{n}" />
		</svg>
	</div>
	<p class="legend">
		Control-flow chart of the code: every statement and structure; decisions show their conditions,
		and calls in a condition run before it. Which branch a request takes depends on runtime data.
		Calls run in order unless marked: ⏳ awaited (caller waits), ⇢ deferred (caller continues; runs
		later), ↪ in a callback (runs if and when it's called), ? may return a promise. ⚡ may throw; ↩
		back to caller. Dashed red: exceptions; dotted: through <code>finally</code>. DB queries show
		under the call that runs them: UPSERT is a database upsert, SAVE an ORM insert-or-update, ? a
		statement outside the supported SQL subset. Detected from Spring Data, JdbcTemplate, TypeORM,
		knex, Prisma, Django, SQLAlchemy, Flask-SQLAlchemy, SQLModel and literal SQL only; other
		libraries aren't detected.
	</p>
	{#if detected}
		<section class="dq" aria-label="Detected queries">
			<h4>
				Detected queries ({detected.partial ? 'at least ' : ''}{detected.queries.length})
			</h4>
			<p class="cap">
				Detected in the code; not all may run, and runtime order can differ.{#if detected.partial}
					The call trace hit its limit, so there may be more.{/if}
			</p>
			{#if detected.queries.length}
				<ol>
					{#each detected.queries as q, i (i)}
						{@const flags = queryFlags(q)}
						<li>
							<span class="qb op-{q.op.toLowerCase()}">{opLabel(q.op)}</span>
							<span class="qt">{q.target ?? '?'}</span>
							{#if flags.length}<span class="qf">{flags.join(' · ')}</span>{/if}
							<code class="qx" title={q.text}>{q.detail ?? q.text}</code>
							<button
								type="button"
								class="qw"
								title="Select {ws.graph.files[q.file]?.path}"
								onclick={() => (ws.selection = { file: q.file })}
								>{q.viaRepository ?? q.fn} · {ws.graph.files[q.file]?.path}:{q.line}</button
							>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="cap">No queries detected in this flow.</p>
			{/if}
		</section>
	{/if}
</div>

{#if ws.chartFullscreen === n}
	<FlowchartFullscreen
		{ws}
		{scene}
		{n}
		label="{endpoint ? `${endpoint.method} ${endpoint.path} — ` : ''}{root.label}"
		method={endpoint?.method ?? null}
		route={endpoint?.path ?? null}
		handler={root.label}
		{summary}
		onexpand={() => (expandingAll = true)}
		oncollapse={collapseAll}
		onclose={() => {
			ws.chartFullscreen = null;
			fullButton?.focus();
		}}
	/>
{/if}

<style>
	.chart {
		margin: 4px 0 10px 24px;
		padding: 8px 10px;
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	.bar {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
	}

	.btn {
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 3px 10px;
		cursor: pointer;
	}

	.summary {
		align-self: center;
		font-size: 11.5px;
		color: var(--muted);
	}

	.scroll {
		overflow: auto;
		max-height: 70vh;
	}

	svg {
		display: block;
	}

	.dq {
		margin-top: 8px;
		border-top: 1px solid var(--line);
		padding-top: 6px;
	}

	.dq h4 {
		margin: 0;
		font-size: 12.5px;
	}

	.cap {
		margin: 2px 0 6px;
		font-size: 11.5px;
		color: var(--muted);
	}

	.dq ol {
		margin: 0;
		padding-left: 22px;
		display: grid;
		gap: 4px;
		font-size: 12px;
	}

	.dq li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 8px;
	}

	.qb {
		--q: var(--muted);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--q);
		border: 1px solid var(--q);
		border-radius: 3px;
		padding: 0 5px;
		background: color-mix(in srgb, var(--q) 14%, transparent);
	}

	.qb.op-select {
		--q: var(--lang-ts);
	}

	.qb.op-insert {
		--q: var(--lang-py);
	}

	.qb.op-update {
		--q: var(--lang-java);
	}

	.qb.op-delete {
		--q: var(--accent);
	}

	.qb.op-upsert {
		--q: var(--blast);
	}

	.qb.op-save {
		--q: var(--lang-js);
		border-style: dashed;
	}

	.qb.op-unknown {
		border-style: dashed;
	}

	.qt {
		font-weight: 700;
	}

	.qf {
		color: var(--muted);
		font-size: 11px;
	}

	.qx {
		font-family: var(--font-mono);
		font-size: 11px;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.qw {
		font: inherit;
		font-size: 11px;
		color: var(--muted);
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-decoration: underline dotted;
	}

	.legend {
		margin: 6px 0 0;
		font-size: 11.5px;
		color: var(--muted);
	}
</style>
