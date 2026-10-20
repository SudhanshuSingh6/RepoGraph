<script lang="ts">
	import type { ColorBy, Workspace } from '#lib/workspace/state.svelte.ts';
	import { ancestry } from './treeNav.ts';

	let { ws }: { ws: Workspace } = $props();

	const COLOR_BY: { value: ColorBy; label: string }[] = [
		{ value: 'lang', label: 'Language' },
		{ value: 'fanIn', label: 'Times imported' },
		{ value: 'fanOut', label: 'Imports made' },
		{ value: 'cycles', label: 'Import cycles' }
	];

	// A filter can hide the zoomed folder; the view then falls back to the root.
	const crumbs = $derived(ancestry(ws.tree, ws.tmPath) ?? [ws.tree]);
</script>

<nav class="crumbs" aria-label="Size map location">
	{#each crumbs as c, i (c.path)}
		{#if i > 0}<span class="sep" aria-hidden="true">/</span>{/if}
		{#if i === crumbs.length - 1}
			<span class="here" aria-current="location">{c.name}</span>
		{:else}
			<button class="crumb" type="button" onclick={() => (ws.tmPath = c.path)}>{c.name}</button>
		{/if}
	{/each}
</nav>
<label class="field">
	Color by
	<select bind:value={ws.colorBy}>
		{#each COLOR_BY as o (o.value)}
			<option value={o.value}>{o.label}</option>
		{/each}
	</select>
</label>
<span class="hint">Click a folder to zoom in, or a file to select it.</span>

<style>
	.crumbs {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: 12.5px;
	}

	.crumb {
		font: inherit;
		color: var(--ink);
		background: none;
		border: none;
		padding: 0;
		text-decoration: underline;
		text-decoration-color: var(--line);
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.crumb:hover {
		color: var(--accent);
	}

	.here {
		font-weight: 700;
	}

	.sep {
		color: var(--muted);
	}
</style>
