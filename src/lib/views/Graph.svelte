<script lang="ts">
	// repograph-spec.md §10: force-directed import graph. D3 owns the SVG contents here
	// (a simulation ticks far faster than a template should re-render); Svelte owns the
	// state it reads.
	import { onMount, untrack } from 'svelte';
	import {
		forceCollide,
		forceLink,
		forceManyBody,
		forceSimulation,
		forceX,
		forceY,
		select,
		zoom,
		zoomIdentity,
		type ForceLink,
		type Selection,
		type Simulation
	} from 'd3';
	import { matchesSearch } from '#lib/workspace/filters.ts';
	import { LANG_NAMES, LANGS } from '#lib/workspace/langs.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import { blastGroups, buildGraphModel } from './graphModel.ts';
	import {
		edgePath,
		forceCluster,
		hoverFocus,
		positionCache,
		type Hover,
		type SimLink,
		type SimNode
	} from './graphSim.ts';

	let { ws }: { ws: Workspace } = $props();

	// Layout constants — the spec names the forces but not their strengths.
	const R_MIN = 4;
	const R_MAX = 24; // radius is linear in lines: R_MIN for 0 lines … R_MAX for the largest
	const LINK_BASE = 40; // link distance before Spacing, beyond both radii
	const CLUSTER_STRENGTH = 0.15;
	const BEND = 0.12; // edge curvature, as a share of its length

	let svg: SVGSVGElement;
	let root: SVGGElement;
	let linkLayer: SVGGElement;
	let nodeLayer: SVGGElement;

	let sim: Simulation<SimNode, SimLink> | null = null;
	let nodeSel: Selection<SVGGElement, SimNode, SVGGElement, unknown> | null = null;
	let linkSel: Selection<SVGPathElement, SimLink, SVGGElement, unknown> | null = null;
	let links: SimLink[] = [];
	const positions = positionCache();

	let hover = $state<Hover>(null);

	const model = $derived(
		buildGraphModel(ws.graph.files, ws.derived, ws.depLevel, {
			hideUnconnected: ws.hideUnconnected,
			onlyCycles: ws.onlyCycles
		})
	);
	const blastOrigin = $derived(
		ws.blast && ws.blastFrom && model.nodes.some((n) => n.id === ws.blastFrom) ? ws.blastFrom : null
	);
	const blastSet = $derived(
		blastOrigin ? blastGroups(model, ws.graph.files, ws.derived, blastOrigin) : null
	);
	const presentLangs = $derived(LANGS.filter((l) => ws.tree.langLoc[l] !== undefined));

	const linkDistance = (l: SimLink) => (LINK_BASE + l.source.r + l.target.r) * ws.spacing;

	function nodeIsSelected(d: SimNode): boolean {
		const sel = ws.selection;
		if (!sel || 'entity' in sel) return false;
		if ('folder' in sel) return sel.folder === d.id;
		return (
			d.files.length === 1 && d.id === ws.graph.files[d.files[0]].path && sel.file === d.files[0]
		);
	}

	function activate(d: SimNode) {
		if (ws.blast) {
			ws.blastFrom = ws.blastFrom === d.id ? null : d.id;
		} else if (d.files.length === 1 && d.id === ws.graph.files[d.files[0]].path) {
			ws.selection = { file: d.files[0] };
		} else {
			ws.selection = { folder: d.id };
		}
	}

	function nodeTip(e: PointerEvent, d: SimNode) {
		const fmt = (n: number) => n.toLocaleString();
		if (d.files.length === 1 && d.id === ws.graph.files[d.files[0]].path) {
			const i = d.files[0];
			ws.showTip(e, d.id, [
				['Language', LANG_NAMES[d.lang]],
				['Lines', fmt(d.loc)],
				['Imported by', fmt(ws.derived.fanIn[i])],
				['Imports', fmt(ws.derived.fanOut[i])]
			]);
		} else {
			ws.showTip(e, d.id, [
				['Files', fmt(d.files.length)],
				['Lines', fmt(d.loc)]
			]);
		}
	}

	onMount(() => {
		const z = zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 6])
			.on('zoom', (e) => root.setAttribute('transform', e.transform.toString()));
		select(svg)
			.call(z)
			.call(z.transform, zoomIdentity.translate(svg.clientWidth / 2, svg.clientHeight / 2))
			.on('click', (e: MouseEvent) => {
				if (e.target === svg) ws.blastFrom = null;
			});
		return () => sim?.stop();
	});

	// Rebuild the simulation whenever the node/arrow set changes, keeping every surviving
	// node where it was.
	$effect(() => {
		const m = model;
		untrack(() => {
			sim?.stop();
			const maxLoc = m.nodes.reduce((a, n) => Math.max(a, n.loc), 1);
			const nodes: SimNode[] = m.nodes.map((n) => ({
				...n,
				r: R_MIN + ((R_MAX - R_MIN) * n.loc) / maxLoc,
				...positions.get(n.id)
			}));
			const byId = new Map(nodes.map((n) => [n.id, n]));
			links = m.links.map((l) => ({
				...l,
				source: byId.get(l.source)!,
				target: byId.get(l.target)!
			}));

			linkSel = select(linkLayer)
				.selectAll<SVGPathElement, SimLink>('path')
				.data(links, (d) => d.id)
				.join('path')
				.attr('class', 'link')
				.classed('cycle', (d) => d.cycle)
				.on('pointermove', (e: PointerEvent, d) => {
					hover = { link: d.id };
					ws.showTip(e, `${d.source.id} → ${d.target.id}`, [
						['Imports', d.count.toLocaleString()],
						...(d.cycle ? ([['Circular', 'yes']] as [string, string][]) : [])
					]);
				})
				.on('pointerleave', () => {
					hover = null;
					ws.hideTip();
				});

			nodeSel = select(nodeLayer)
				.selectAll<SVGGElement, SimNode>('g.node')
				.data(nodes, (d) => d.id)
				.join((enter) => {
					const g = enter
						.append('g')
						.attr('class', 'node')
						.attr('role', 'button')
						.attr('tabindex', 0);
					g.append('circle');
					g.append('text').attr('dy', '0.32em');
					return g;
				})
				.attr('aria-label', (d) => d.id)
				.classed('cyc', (d) => d.inCycle)
				.on('click', (e: MouseEvent, d) => {
					e.stopPropagation();
					activate(d);
				})
				.on('keydown', (e: KeyboardEvent, d) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						activate(d);
					}
				})
				.on('pointermove', (e: PointerEvent, d) => {
					if (!(hover && 'node' in hover && hover.node === d.id)) hover = { node: d.id };
					nodeTip(e, d);
				})
				.on('pointerleave', () => {
					hover = null;
					ws.hideTip();
				});
			nodeSel
				.select('circle')
				.attr('r', (d) => d.r)
				.style('fill', (d) => (d.inCycle ? 'var(--accent)' : `var(--lang-${d.lang})`));
			nodeSel
				.select('text')
				.attr('x', (d) => d.r + 4)
				.text((d) => d.label);

			const fresh = nodes.some((n) => n.x === undefined);
			lastSpacing = ws.spacing;
			lastCluster = ws.cluster;
			sim = forceSimulation(nodes)
				.force('link', forceLink<SimNode, SimLink>(links).distance(linkDistance).strength(0.4))
				.force(
					'charge',
					forceManyBody<SimNode>().strength((d) => -90 - d.r * 10)
				)
				.force(
					'collide',
					forceCollide<SimNode>((d) => d.r + 3)
				)
				.force('x', forceX(0).strength(0.04))
				.force('y', forceY(0).strength(0.04))
				.force('cluster', ws.cluster ? forceCluster(CLUSTER_STRENGTH) : null)
				.alpha(fresh ? 1 : 0.4)
				.on('tick', () => {
					linkSel!.attr('d', (l) => edgePath(l, BEND));
					nodeSel!.attr('transform', (d) => `translate(${d.x},${d.y})`);
					for (const n of nodes) positions.set(n.id, { x: n.x!, y: n.y! });
				});
			paint();
		});
	});

	// Spacing and Cluster by folder adjust the running simulation instead of rebuilding.
	let lastSpacing = NaN; // set when the simulation is built
	$effect(() => {
		const s = ws.spacing;
		if (!sim || s === lastSpacing) return;
		lastSpacing = s;
		(sim.force('link') as ForceLink<SimNode, SimLink>).distance(linkDistance);
		sim.alpha(0.5).restart();
	});
	let lastCluster: boolean | null = null;
	$effect(() => {
		const on = ws.cluster;
		if (!sim || on === lastCluster) return;
		lastCluster = on;
		sim.force('cluster', on ? forceCluster(CLUSTER_STRENGTH) : null);
		sim.alpha(0.5).restart();
	});

	/** Highlight state: hover tracing, blast radius, search dimming, selection, labels. */
	function paint() {
		if (!nodeSel || !linkSel) return;
		const query = ws.search;
		const searching = query.trim() !== '';
		const files = ws.graph.files;

		const { nodes: focus, links: focusLinks } = hoverFocus(links, hover);

		const origin = blastOrigin;
		const hit = blastSet;
		const inBlast = (n: SimNode) => n.id === origin || (hit?.has(n.id) ?? false);

		nodeSel
			.classed(
				'dim',
				(d) =>
					(searching && !d.files.some((i) => matchesSearch(files[i].path, query))) ||
					(focus !== null && !focus.has(d.id)) ||
					(hit !== null && !inBlast(d))
			)
			.classed('blast', (d) => hit?.has(d.id) ?? false)
			.classed('origin', (d) => d.id === origin)
			.classed('sel', nodeIsSelected)
			.classed(
				'labelled',
				(d) => ws.allLabels || (focus?.has(d.id) ?? false) || nodeIsSelected(d) || d.id === origin
			);
		linkSel
			.classed('hl', (l) => focusLinks?.has(l.id) ?? false)
			.classed('dim', (l) =>
				focusLinks ? !focusLinks.has(l.id) : hit ? !(inBlast(l.source) && inBlast(l.target)) : false
			)
			.classed('blast', (l) => hit !== null && inBlast(l.source) && inBlast(l.target))
			.attr('marker-end', (l) =>
				hit !== null && inBlast(l.source) && inBlast(l.target)
					? 'url(#dep-arrow-blast)'
					: l.cycle
						? 'url(#dep-arrow-cycle)'
						: 'url(#dep-arrow)'
			);
	}

	$effect(() => {
		// Dependencies for the repaint (paint() reads them through non-tracked selections).
		void [model, hover, blastSet, blastOrigin, ws.search, ws.allLabels, ws.selection];
		untrack(paint);
	});
</script>

<div class="wrap">
	<svg bind:this={svg} class="graph" role="img" aria-label="Import graph">
		<defs>
			{#each [['dep-arrow', 'var(--edge)'], ['dep-arrow-cycle', 'var(--accent)'], ['dep-arrow-blast', 'var(--blast)']] as [id, color] (id)}
				<marker
					{id}
					viewBox="0 -5 10 10"
					refX="10"
					markerWidth="7"
					markerHeight="7"
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<path d="M0,-5L10,0L0,5" style:fill={color} />
				</marker>
			{/each}
		</defs>
		<g bind:this={root}>
			<g bind:this={linkLayer} class="links"></g>
			<g bind:this={nodeLayer} class="nodes"></g>
		</g>
	</svg>

	{#if model.nodes.length === 0}
		<p class="empty">
			{ws.onlyCycles
				? 'No import cycles among the files shown.'
				: 'No imports between the files shown. Turn off “Hide unconnected” to see every file.'}
		</p>
	{/if}

	<div class="legend" aria-label="Color key">
		{#each presentLangs as l (l)}
			<span class="key"><i class="dot" style:background="var(--lang-{l})"></i>{LANG_NAMES[l]}</span>
		{/each}
		<span class="key"><i class="line"></i>import</span>
		<span class="key"><i class="line cycle"></i>circular import</span>
		<span class="key muted">circle size shows lines</span>
		{#if ws.blast}
			<span class="key"
				><i class="dot" style:background="var(--blast)"></i>affected by a change to the clicked
				circle</span
			>
		{/if}
	</div>
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	.graph {
		display: block;
		width: 100%;
		height: 100%;
		cursor: grab;
		user-select: none;
	}

	.graph:active {
		cursor: grabbing;
	}

	.graph :global(.link) {
		fill: none;
		stroke: var(--edge);
		stroke-width: 1.2;
		transition: opacity 0.15s;
	}

	.graph :global(.link.cycle) {
		stroke: var(--accent);
		stroke-width: 1.8;
	}

	.graph :global(.link.hl) {
		stroke-width: 2.6;
	}

	.graph :global(.link.blast) {
		stroke: var(--blast);
		stroke-width: 1.8;
	}

	.graph :global(.link.dim) {
		opacity: 0.1;
	}

	.graph :global(.node) {
		cursor: pointer;
		outline: none;
		transition: opacity 0.15s;
	}

	.graph :global(.node circle) {
		stroke: var(--panel);
		stroke-width: 1.5;
	}

	.graph :global(.node.blast circle) {
		fill: var(--blast) !important;
	}

	.graph :global(.node.origin circle),
	.graph :global(.node.sel circle),
	.graph :global(.node:focus-visible circle) {
		stroke: var(--ink);
		stroke-width: 3;
	}

	.graph :global(.node text) {
		display: none;
		fill: var(--ink);
		font-size: 11.5px;
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 3px;
		stroke-linejoin: round;
		pointer-events: none;
	}

	.graph :global(.node.labelled text),
	.graph :global(.node:hover text),
	.graph :global(.node:focus-visible text) {
		display: block;
	}

	.graph :global(.node.sel text),
	.graph :global(.node.origin text) {
		font-weight: 700;
	}

	.graph :global(.node.dim) {
		opacity: 0.14;
	}

	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		padding: 24px;
		color: var(--muted);
		text-align: center;
		pointer-events: none;
	}

	.legend {
		position: absolute;
		left: 12px;
		bottom: 12px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 14px;
		max-width: calc(100% - 24px);
		padding: 7px 11px;
		font-size: 12px;
		background: color-mix(in srgb, var(--panel) 92%, transparent);
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	.key {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.line {
		width: 18px;
		height: 0;
		border-top: 1.5px solid var(--edge);
	}

	.line.cycle {
		border-top: 2px solid var(--accent);
	}

	.muted {
		color: var(--muted);
	}
</style>
