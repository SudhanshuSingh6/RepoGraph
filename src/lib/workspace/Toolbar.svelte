<script lang="ts">
	// repograph-spec.md §15: view tabs, language chips (+ "Hide tests"), search box.
	import { langCounts } from './filters.ts';
	import { LANG_NAMES } from './langs.ts';
	import type { View, Workspace } from './state.svelte.ts';

	let { ws }: { ws: Workspace } = $props();

	const TABS: { id: View; label: string }[] = [
		{ id: 'tree', label: 'Tree' },
		{ id: 'treemap', label: 'Size map' },
		{ id: 'graph', label: 'Dependencies' },
		{ id: 'uml', label: 'Architecture' },
		{ id: 'er', label: 'ER Diagram' },
		{ id: 'hotspots', label: 'Hotspots' },
		{ id: 'apis', label: 'APIs' }
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

	<button
		type="button"
		class="chip chat"
		style:--c="var(--ink)"
		aria-pressed={ws.chatOpen}
		aria-controls="chat-panel"
		title={ws.chatOpen ? 'Hide chat' : 'Show chat'}
		onclick={() => ws.toggleChat()}
	>
		<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
			<path
				fill="currentColor"
				d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3.2 2.6a.5.5 0 0 1-.8-.4V11h0A1.5 1.5 0 0 1 2 9.5z"
			/>
		</svg>
		Chat
	</button>
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

	.tab:hover {
		border-color: var(--line);
	}

	.tab[aria-selected='true'] {
		color: var(--panel);
		background: var(--ink);
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

	/* The chat panel toggle: filled while the panel is open, outlined (not dimmed) when
	   closed, so it stays easy to find. */
	.chip.chat {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--panel);
	}

	.chip.chat[aria-pressed='false'] {
		color: var(--ink);
		opacity: 1;
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
