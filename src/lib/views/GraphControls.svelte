<script lang="ts">
	import { UNGROUPED, groupCount } from '#analysis/graph/index.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';

	let { ws }: { ws: Workspace } = $props();

	const index = $derived(Math.max(0, ws.levels.indexOf(ws.depLevel)));
	const activeFiles = $derived(ws.graph.files.filter((_, i) => ws.active[i]));
	const detail = $derived(
		ws.depLevel === UNGROUPED
			? 'every file'
			: `${groupCount(activeFiles, ws.depLevel).toLocaleString()} folders, depth ${ws.depLevel}`
	);
</script>

<label class="field">
	Detail
	<input
		type="range"
		min="0"
		max={ws.levels.length - 1}
		step="1"
		value={index}
		oninput={(e) => {
			ws.depLevel = ws.levels[Number(e.currentTarget.value)];
			ws.blastFrom = null;
		}}
		aria-valuetext={detail}
	/>
	<span class="val">{detail}</span>
</label>
<label class="field">
	Spacing
	<input type="range" min="0.6" max="3" step="0.1" bind:value={ws.spacing} />
	<span class="val">{ws.spacing.toFixed(1)}×</span>
</label>
<label class="check"
	><input type="checkbox" bind:checked={ws.hideUnconnected} /> Hide unconnected</label
>
<label class="check"><input type="checkbox" bind:checked={ws.onlyCycles} /> Only cycles</label>
<label class="check"><input type="checkbox" bind:checked={ws.allLabels} /> All labels</label>
<label class="check">
	<input
		type="checkbox"
		bind:checked={ws.blast}
		onchange={() => {
			ws.blastFrom = null;
		}}
	/> Blast radius
</label>
<label class="check"><input type="checkbox" bind:checked={ws.cluster} /> Cluster by folder</label>
<span class="hint">
	{ws.blast
		? 'Click a circle to see everything a change to it could affect.'
		: 'Hover a circle to trace its imports. Scroll to zoom, drag to pan.'}
</span>

<style>
	.val {
		min-width: 4ch;
		font-family: var(--font-mono);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12.5px;
		cursor: pointer;
	}

	input[type='checkbox'],
	input[type='range'] {
		accent-color: var(--accent);
	}

	input[type='range'] {
		width: 110px;
	}
</style>
