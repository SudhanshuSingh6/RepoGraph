<script lang="ts">
	import type { Workspace } from '#lib/workspace/state.svelte.ts';

	let { ws }: { ws: Workspace } = $props();
</script>

<label class="field">
	Group by
	<select bind:value={ws.apisGroup}>
		<option value="path">Path</option>
		<option value="file">File</option>
	</select>
</label>
<span class="hint">
	Detected by static analysis from Spring, NestJS, Express, Flask, FastAPI and Django route
	declarations. Routes built at runtime aren't detected. Click a handler or file to select it.
</span>
