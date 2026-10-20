<script lang="ts">
	// repograph-spec.md §8: a D3 node-link dendrogram of the path tree, with pan/zoom.
	import { onMount } from 'svelte';
	import {
		hierarchy,
		linkHorizontal,
		select,
		tree as treeLayout,
		zoom,
		zoomIdentity,
		type HierarchyPointLink,
		type HierarchyPointNode,
		type ZoomTransform
	} from 'd3';
	import type { TreeNode } from '#analysis/graph/index.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import { searchHits } from './treeNav.ts';

	let { ws }: { ws: Workspace } = $props();

	const ROW = 22; // vertical gap between siblings
	const COLUMN = 190; // horizontal gap between depths

	let svg: SVGSVGElement;
	let transform = $state<ZoomTransform>(zoomIdentity);

	const layout = $derived(
		treeLayout<TreeNode>().nodeSize([ROW, COLUMN])(
			hierarchy(ws.tree, (d) => (ws.treeExpanded.has(d.path) ? d.children : undefined))
		)
	);
	const nodes = $derived(layout.descendants());
	const links = $derived(layout.links());
	const hits = $derived(searchHits(ws.tree, ws.graph.files, ws.search));

	const linkPath = linkHorizontal<HierarchyPointLink<TreeNode>, HierarchyPointNode<TreeNode>>()
		.x((d) => d.y)
		.y((d) => d.x);

	onMount(() => {
		// Room on the left for the root's label, which sits left of its node once expanded.
		const left = 24 + ws.tree.name.length * 7.5;
		const z = zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 4])
			.on('zoom', (e) => (transform = e.transform));
		select(svg)
			.call(z)
			.call(z.transform, zoomIdentity.translate(left, svg.clientHeight / 2));
	});

	const isFolder = (d: TreeNode) => d.children !== undefined;
	const isOpen = (d: TreeNode) => isFolder(d) && ws.treeExpanded.has(d.path);

	function activate(d: TreeNode) {
		if (isFolder(d)) {
			if (ws.treeExpanded.has(d.path)) ws.treeExpanded.delete(d.path);
			else ws.treeExpanded.add(d.path);
		} else {
			ws.selection = { file: d.file! };
		}
	}

	function onKey(e: KeyboardEvent, d: TreeNode) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			activate(d);
		}
	}
</script>

<svg bind:this={svg} class="tree" role="img" aria-label="Codebase tree">
	<g transform={transform.toString()}>
		{#each links as l (l.target.data.path)}
			<path class="link" d={linkPath(l)} class:dim={hits && !hits.has(l.target.data.path)} />
		{/each}
		{#each nodes as n (n.data.path)}
			{@const d = n.data}
			<g
				class="node"
				class:folder={isFolder(d)}
				class:open={isOpen(d)}
				class:sel={ws.isSelectedFile(d.file)}
				class:dim={hits && !hits.has(d.path)}
				transform="translate({n.y},{n.x})"
				role="button"
				tabindex="0"
				aria-label={isFolder(d)
					? `${d.path || d.name}, folder, ${isOpen(d) ? 'expanded' : 'collapsed'}`
					: d.path}
				aria-expanded={isFolder(d) ? isOpen(d) : undefined}
				onclick={() => activate(d)}
				onkeydown={(e) => onKey(e, d)}
				onpointermove={(e) => ws.showNodeTip(e, d)}
				onpointerleave={() => ws.hideTip()}
			>
				<circle
					r={isFolder(d) ? 5.5 : 4.5}
					style:fill={isFolder(d) ? null : `var(--lang-${d.lang})`}
				/>
				<text dy="0.32em" x={isOpen(d) ? -10 : 10} text-anchor={isOpen(d) ? 'end' : 'start'}
					>{d.name}</text
				>
			</g>
		{/each}
	</g>
</svg>

<style>
	.tree {
		display: block;
		width: 100%;
		height: 100%;
		cursor: grab;
		user-select: none;
	}

	.tree:active {
		cursor: grabbing;
	}

	.link {
		fill: none;
		stroke: var(--edge);
		stroke-width: 1.2;
	}

	.node {
		cursor: pointer;
		outline: none;
	}

	.node circle {
		stroke: var(--panel);
		stroke-width: 1.5;
	}

	/* Folders: filled while collapsed (there is more inside), hollow once expanded. */
	.node.folder circle {
		fill: var(--muted);
		stroke: var(--muted);
	}

	.node.folder.open circle {
		fill: var(--panel);
	}

	.node text {
		fill: var(--ink);
		font-size: 12px;
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 3px;
		stroke-linejoin: round;
	}

	.node.folder text {
		font-weight: 600;
	}

	.node:hover text,
	.node:focus-visible text {
		fill: var(--accent);
	}

	.node:focus-visible circle {
		stroke: var(--accent);
		stroke-width: 2.5;
	}

	.node.sel text {
		fill: var(--accent);
		font-weight: 700;
	}

	.node.sel circle {
		stroke: var(--accent);
		stroke-width: 2.5;
	}

	.dim {
		opacity: 0.28;
	}
</style>
