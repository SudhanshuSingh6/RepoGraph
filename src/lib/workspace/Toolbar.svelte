<script lang="ts">
	// repograph-spec.md §15: view tabs, language chips (+ "Hide tests"), search box.
	import { langCounts } from './filters.ts';
	import { LANG_NAMES } from './langs.ts';
	import type { View, Workspace } from './state.svelte.ts';

	let { ws }: { ws: Workspace } = $props();

	// `ready: false` until the view's build phase lands (BUILD_PLAN.md Phases 6–7).
	const TABS: { id: View; label: string; ready: boolean }[] = [
		{ id: 'tree', label: 'Tree', ready: true },
		{ id: 'treemap', label: 'Size map', ready: true },
		{ id: 'graph', label: 'Dependencies', ready: true },
		{ id: 'uml', label: 'Architecture', ready: true },
		{ id: 'er', label: 'ER Diagram', ready: true },
		{ id: 'hotspots', label: 'Hotspots', ready: false }
	];

	const chips = $derived(langCounts(ws.graph.files, ws.hideTests));
	const testCount = $derived(ws.graph.files.filter((f) => f.isTest).length);
</script>

<div class="toolbar">
	<div class="tabs" role="tablist" aria-label="Views">
		{#each TABS as t (t.id)}
			<button
				type="button"
				role="tab"
				class="tab"
				aria-selected={ws.view === t.id}
				disabled={!t.ready}
				title={t.ready ? undefined : 'Coming in a later build phase'}
				onclick={() => (ws.view = t.id)}>{t.label}</button
			>
		{/each}
	</div>

	<div class="chips" role="group" aria-label="Filters">
		{#each chips as c (c.lang)}
			<button
				type="button"
				class="chip"
				style:--c="var(--lang-{c.lang})"
				aria-pressed={ws.langOn[c.lang] !== false}
				onclick={() => ws.toggleLang(c.lang)}
			>
				{LANG_NAMES[c.lang]} <span class="n">{c.files.toLocaleString()}</span>
			</button>
		{/each}
		{#if testCount > 0}
			<button
				type="button"
				class="chip tests"
				style:--c="var(--ink)"
				aria-pressed={ws.hideTests}
				onclick={() => (ws.hideTests = !ws.hideTests)}
			>
				Hide tests <span class="n">{testCount.toLocaleString()}</span>
			</button>
		{/if}
	</div>

	<input
		class="search"
		type="search"
		placeholder="Search files"
		aria-label="Search file paths"
		bind:value={ws.search}
	/>
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
		padding: 10px 18px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.tab {
		font: inherit;
		font-weight: 600;
		color: var(--ink);
		background: none;
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 5px 13px;
		cursor: pointer;
	}

	.tab:hover:not(:disabled) {
		border-color: var(--line);
	}

	.tab[aria-selected='true'] {
		color: var(--panel);
		background: var(--ink);
	}

	.tab:disabled {
		color: var(--muted);
		opacity: 0.55;
		cursor: not-allowed;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: #0e2b33;
		background: var(--c);
		border: 1.5px solid var(--c);
		border-radius: 999px;
		padding: 3px 10px;
		cursor: pointer;
	}

	.chip .n {
		font-family: var(--font-mono);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}

	/* Unpressed: dims to 50% and loses its fill (§15). */
	.chip[aria-pressed='false'] {
		color: var(--ink);
		background: transparent;
		opacity: 0.5;
	}

	/* "Hide tests" reads the other way round: pressed means tests are filtered out. */
	.chip.tests {
		color: var(--panel);
	}

	.chip.tests[aria-pressed='false'] {
		color: var(--ink);
	}

	.search {
		margin-left: auto;
		width: 240px;
		font: inherit;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 5px 13px;
	}

	@media (max-width: 900px) {
		.search {
			width: 100%;
		}
	}
</style>
