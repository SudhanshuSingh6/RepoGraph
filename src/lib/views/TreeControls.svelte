<script lang="ts">
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import { folderPaths } from './treeNav.ts';

	let { ws }: { ws: Workspace } = $props();

	function expandAll() {
		for (const p of folderPaths(ws.tree)) ws.treeExpanded.add(p);
	}

	function collapseAll() {
		ws.treeExpanded.clear();
		ws.treeExpanded.add('');
	}
</script>

<button class="btn" type="button" onclick={expandAll}>Expand all</button>
<button class="btn" type="button" onclick={collapseAll}>Collapse all</button>
<span class="hint">Click a folder to expand or collapse it. Scroll to zoom, drag to pan.</span>
