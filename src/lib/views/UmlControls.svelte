<script lang="ts">
	import { UNGROUPED, groupCount } from '#analysis/graph/index.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';

	let { ws }: { ws: Workspace } = $props();

	// Boxes are packages, so the slider has folder levels only (no per-file level) —
	// unless the repo has no folders at all.
	const levels = $derived.by(() => {
		const folders = ws.levels.filter((l) => l !== UNGROUPED);
		return folders.length ? folders : [UNGROUPED];
	});
	const index = $derived(Math.max(0, levels.indexOf(ws.umlLevel)));
	const activeFiles = $derived(ws.graph.files.filter((_, i) => ws.active[i]));
	const detail = $derived(
		ws.umlLevel === UNGROUPED
			? 'every file'
			: `${groupCount(activeFiles, ws.umlLevel).toLocaleString()} packages, depth ${ws.umlLevel}`
	);
</script>

{#if ws.umlFolder === null}
	<label class="field">
		Detail
		<input
			type="range"
			min="0"
			max={levels.length - 1}
			step="1"
			value={index}
			disabled={levels.length < 2}
			oninput={(e) => (ws.umlLevel = levels[Number(e.currentTarget.value)])}
			aria-valuetext={detail}
		/>
		<span class="val">{detail}</span>
	</label>
	<span class="hint">Click a package to open its class diagram. Scroll to zoom, drag to pan.</span>
{:else}
	<button class="btn" type="button" onclick={() => (ws.umlFolder = null)}>← Back</button>
	<nav class="crumbs" aria-label="Architecture location">
		<button class="crumb" type="button" onclick={() => (ws.umlFolder = null)}>{ws.name}</button>
		<span class="sep" aria-hidden="true">/</span>
		<span class="here" aria-current="location">{ws.umlFolder}</span>
	</nav>
	<span class="hint">Solid arrow = extends, dashed = implements.</span>
{/if}

<style>
	.val {
		font-family: var(--font-mono);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}

	input[type='range'] {
		width: 110px;
		accent-color: var(--accent);
	}

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
		word-break: break-all;
	}

	.sep {
		color: var(--muted);
	}
</style>
