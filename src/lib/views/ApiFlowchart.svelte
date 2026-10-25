<script lang="ts">
	// One endpoint's control-flow chart: the handler's statements and structures, with
	// its calls opening inline (see packages/analysis/apis/cfg.ts for the semantics and
	// layout/flowchartLayout.ts for the drawing).
	import { refKey, type FnChart } from '#analysis/apis/flowchart.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import FlowchartFullscreen from './FlowchartFullscreen.svelte';
	import FlowchartSvg from './FlowchartSvg.svelte';
	import { closedSummary, closedWords, layoutChart } from './layout/flowchartLayout.ts';

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
		back to caller. Dashed red: exceptions; dotted: through <code>finally</code>.
	</p>
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

	.legend {
		margin: 6px 0 0;
		font-size: 11.5px;
		color: var(--muted);
	}
</style>
