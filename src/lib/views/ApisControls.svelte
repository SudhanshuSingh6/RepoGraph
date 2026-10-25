<script lang="ts">
	import { matchesEndpoint } from '#analysis/apis/index.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';

	let { ws }: { ws: Workspace } = $props();

	const EXPAND_MAX = 20; // each open row fetches and draws a diagram
	let note = $state<string | null>(null);

	function expandAll() {
		const shown = (ws.apis ?? []).flatMap((e, i) =>
			ws.active[e.file] && matchesEndpoint(e, ws.graph.files, ws.search) && e.handler.fn !== null
				? [i]
				: []
		);
		for (const n of shown.slice(0, EXPAND_MAX)) ws.apisOpen.add(n);
		note = shown.length > EXPAND_MAX ? `Opened the first ${EXPAND_MAX} of ${shown.length}.` : null;
	}
</script>

<button type="button" class="btn" onclick={expandAll}>Expand all</button>
<button
	type="button"
	class="btn"
	onclick={() => {
		ws.apisOpen.clear();
		ws.chartFullscreen = null;
		note = null;
	}}>Collapse all</button
>
{#if note}<span class="note">{note}</span>{/if}

<label class="field">
	Group by
	<select bind:value={ws.apisGroup}>
		<option value="path">Path</option>
		<option value="file">File</option>
	</select>
</label>
<span class="hint">
	Static analysis of Spring, NestJS, Express, Flask, FastAPI and Django code: shows what the code
	can do, not what a given request does. Routes built at runtime, and calls through reflection, DI
	by name or dynamic dispatch, may be missing.
</span>

<style>
	.note {
		font-size: 12px;
		color: var(--muted);
	}
</style>
