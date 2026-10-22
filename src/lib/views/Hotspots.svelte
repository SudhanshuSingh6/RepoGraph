<script lang="ts">
	// repograph-spec.md §13/§14: five ranked cards — largest, most imported, most
	// dependent, import cycles and possibly unused. Clicking a row selects its file.
	import { UNGROUPED } from '#analysis/graph/index.ts';
	import { importCycles, possiblyUnused, ranked } from '#analysis/hotspots/index.ts';
	import { referencedTypes } from '#analysis/types/index.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';

	let { ws }: { ws: Workspace } = $props();

	const CYCLE_SHOWN = 25; // members listed per expanded cycle
	const fmt = (n: number) => n.toLocaleString();
	const base = (i: number) => {
		const p = ws.graph.files[i].path;
		return p.slice(p.lastIndexOf('/') + 1);
	};
	const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

	$effect(() => ws.loadTypes());

	const files = $derived(ws.graph.files);
	const d = $derived(ws.derived);
	const anyActive = $derived(ws.active.some(Boolean));
	const largest = $derived(ranked(files, ws.active, (i) => files[i].loc));
	const mostImported = $derived(ranked(files, ws.active, (i) => d.fanIn[i]));
	const mostDependent = $derived(ranked(files, ws.active, (i) => d.fanOut[i]));
	const cycles = $derived(importCycles(files, d));
	// The cross-reference spans the whole repo (§14), whatever the filters hide.
	const referenced = $derived(ws.types ? referencedTypes(ws.types, files, ws.full.adj) : null);
	const unused = $derived(
		ws.types && referenced
			? possiblyUnused(
					files,
					d,
					ws.types.map((t) => t.file),
					referenced
				)
			: null
	);

	function viewInGraph(cycle: number[]) {
		// Per-file Detail, so the selected file has a node of its own to highlight.
		ws.depLevel = UNGROUPED;
		ws.selection = { file: cycle[0] };
		ws.view = 'graph';
	}
</script>

{#snippet fileRow(i: number, metric: string)}
	<li>
		<button
			type="button"
			class="row"
			class:sel={ws.isSelectedFile(i)}
			onclick={() => (ws.selection = { file: i })}
		>
			<span class="name">{base(i)}</span>
			<span class="path">{files[i].path}</span>
			<span class="metric">{metric}</span>
		</button>
	</li>
{/snippet}

{#snippet ranking(list: number[], metric: (i: number) => string, empty: string)}
	{#if !anyActive}
		<p class="empty">No files match the current filters.</p>
	{:else if list.length === 0}
		<p class="empty">{empty}</p>
	{:else}
		<ol class="list">
			{#each list as i (i)}
				{@render fileRow(i, metric(i))}
			{/each}
		</ol>
	{/if}
{/snippet}

<div class="hotspots">
	<section class="card" aria-labelledby="hs-largest">
		<h2 id="hs-largest">Largest files</h2>
		<p class="sub">The most lines of code (non-blank lines).</p>
		{@render ranking(largest, (i) => plural(files[i].loc, 'line', 'lines'), 'No files.')}
	</section>

	<section class="card" aria-labelledby="hs-imported">
		<h2 id="hs-imported">Most imported</h2>
		<p class="sub">Files where a change has the widest blast radius.</p>
		{@render ranking(
			mostImported,
			(i) => `imported by ${fmt(d.fanIn[i])}`,
			'No file is imported by another.'
		)}
	</section>

	<section class="card" aria-labelledby="hs-dependent">
		<h2 id="hs-dependent">Most dependent</h2>
		<p class="sub">Files that import the most other files.</p>
		{@render ranking(
			mostDependent,
			(i) => `imports ${fmt(d.fanOut[i])}`,
			'No file imports another.'
		)}
	</section>

	<section class="card" aria-labelledby="hs-cycles">
		<h2 id="hs-cycles">Import cycles</h2>
		<p class="sub">Files that import each other, directly or through a chain.</p>
		{#if !anyActive}
			<p class="empty">No files match the current filters.</p>
		{:else if cycles.length === 0}
			<p class="empty">No import cycles.</p>
		{:else}
			<div class="list">
				{#each cycles as cycle (cycle.join())}
					<details class="cycle">
						<summary>
							<b>{plural(cycle.length, 'file', 'files')}:</b>
							{cycle.slice(0, 3).map(base).join(', ')}{cycle.length > 3 ? ' and more' : ''}
						</summary>
						<ul class="members">
							{#each cycle.slice(0, CYCLE_SHOWN) as i (i)}
								{@render fileRow(i, plural(files[i].loc, 'line', 'lines'))}
							{/each}
						</ul>
						{#if cycle.length > CYCLE_SHOWN}
							<p class="more">and {fmt(cycle.length - CYCLE_SHOWN)} more</p>
						{/if}
						<button type="button" class="link" onclick={() => viewInGraph(cycle)}>
							View in graph →
						</button>
					</details>
				{/each}
			</div>
		{/if}
	</section>

	<section class="card" aria-labelledby="hs-unused">
		<h2 id="hs-unused">Possibly unused</h2>
		<p class="sub">
			Nothing imports or extends these, and they aren't tests or entry points. They may still be
			used dynamically, loaded by a framework, called from outside this codebase, or be a public API
			— check before deleting.
		</p>
		{#if ws.typesError}
			<p class="empty">{ws.typesError}</p>
		{:else if !unused}
			<p class="empty">Reading classes…</p>
		{:else}
			{@render ranking(unused, (i) => `imports ${fmt(d.fanOut[i])}`, 'Nothing looks unused.')}
		{/if}
	</section>
</div>

<style>
	.hotspots {
		position: absolute;
		inset: 0;
		overflow: auto;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
		align-content: start;
		gap: 14px;
		padding: 16px;
	}

	.card {
		display: flex;
		flex-direction: column;
		min-width: 0;
		max-height: 440px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 14px 14px 10px;
	}

	h2 {
		margin: 0;
		font-size: 15px;
	}

	.sub {
		margin: 2px 0 10px;
		font-size: 12.5px;
		color: var(--muted);
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		min-height: 0;
	}

	.list :global(li),
	.members :global(li) {
		list-style: none;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas: 'name metric' 'path metric';
		column-gap: 10px;
		width: 100%;
		padding: 5px 6px;
		font: inherit;
		text-align: left;
		color: var(--ink);
		background: none;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}

	.row:hover,
	.row:focus-visible {
		background: var(--panel2);
	}

	.row.sel {
		background: var(--panel2);
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.name {
		grid-area: name;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.path {
		grid-area: path;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.metric {
		grid-area: metric;
		align-self: center;
		font-family: var(--font-mono);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}

	.cycle {
		border-top: 1px solid var(--line);
		padding: 6px 2px;
	}

	.cycle:first-child {
		border-top: none;
	}

	summary {
		cursor: pointer;
		font-size: 13px;
		color: var(--accent);
	}

	summary b {
		color: var(--ink);
	}

	.members {
		margin: 4px 0 0;
		padding: 0;
	}

	.more {
		margin: 2px 6px;
		font-size: 12px;
		color: var(--muted);
	}

	.link {
		margin: 4px 6px 2px;
		padding: 0;
		font: inherit;
		font-size: 12.5px;
		color: var(--accent);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.empty {
		margin: 6px 0;
		color: var(--muted);
		font-size: 13px;
	}
</style>
