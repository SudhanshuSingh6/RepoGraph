<script lang="ts">
	// repograph-spec.md §9: every file as a rectangle sized by line count; folders zoom.
	import { hierarchy, treemap } from 'd3';
	import type { TreeNode } from '#analysis/graph/index.ts';
	import { LANG_NAMES, LANGS } from '#lib/workspace/langs.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import { FAN_IN_RAMP, FAN_OUT_RAMP, fileFill } from './treemapColors.ts';
	import { findNode, searchHits } from './treeNav.ts';

	let { ws }: { ws: Workspace } = $props();

	const LABEL_BAND = 18; // folder label strip above its children
	const CHAR_PX = 6.6; // rough width of one 11px label character

	let width = $state(0);
	let height = $state(0);

	const focus = $derived(findNode(ws.tree, ws.tmPath) ?? ws.tree);
	const hits = $derived(searchHits(ws.tree, ws.graph.files, ws.search));
	const scales = $derived({ maxFanIn: ws.tree.maxFanIn, maxFanOut: ws.tree.maxFanOut });

	const cells = $derived.by(() => {
		if (!width || !height) return [];
		const root = hierarchy(focus)
			.sum((d) => (d.file !== undefined ? d.loc : 0))
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
		treemap<TreeNode>()
			.size([width, height])
			.round(true)
			.paddingOuter(3)
			.paddingInner(2)
			.paddingTop((d) => (d === root ? 3 : LABEL_BAND))(root);
		return root
			.descendants()
			.slice(1)
			.map((n) => {
				const r = n as typeof n & { x0: number; y0: number; x1: number; y1: number };
				return { d: n.data, x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
			})
			.filter((c) => c.w > 0 && c.h > 0);
	});

	const presentLangs = $derived(LANGS.filter((l) => ws.tree.langLoc[l] !== undefined));

	function fit(label: string, px: number): string {
		const n = Math.floor(px / CHAR_PX);
		if (n < 2) return '';
		return label.length <= n ? label : label.slice(0, n - 1) + '…';
	}

	function fillOf(d: TreeNode) {
		const i = d.file!;
		return fileFill(ws.colorBy, scales, {
			node: d,
			fanIn: ws.derived.fanIn[i],
			fanOut: ws.derived.fanOut[i],
			inCycle: ws.derived.inCycle[i]
		});
	}

	function activate(d: TreeNode) {
		if (d.children) ws.tmPath = d.path;
		else ws.selection = { file: d.file! };
	}

	function onKey(e: KeyboardEvent, d: TreeNode) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			activate(d);
		}
	}
</script>

<div class="wrap" bind:clientWidth={width} bind:clientHeight={height}>
	<svg class="treemap" {width} {height} role="img" aria-label="Size map">
		<defs>
			<!-- §9 reserves this texture for a "block" sub-type; no node is one yet. -->
			<pattern id="tm-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
				<path d="M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2" stroke="rgba(0,0,0,.25)" stroke-width="1" />
			</pattern>
		</defs>
		{#each cells as c (c.d.path)}
			{@const folder = c.d.children !== undefined}
			{@const f = folder ? null : fillOf(c.d)}
			<g
				class="cell"
				class:folder
				class:sel={ws.isSelectedFile(c.d.file)}
				class:dim={hits && !hits.has(c.d.path)}
				transform="translate({c.x},{c.y})"
				role="button"
				tabindex="0"
				aria-label={folder ? `${c.d.path}, folder — zoom in` : c.d.path}
				onclick={(e) => {
					e.stopPropagation();
					activate(c.d);
				}}
				onkeydown={(e) => onKey(e, c.d)}
				onpointermove={(e) => {
					e.stopPropagation();
					ws.showNodeTip(e, c.d);
				}}
				onpointerleave={() => ws.hideTip()}
			>
				<rect width={c.w} height={c.h} style:fill={f?.fill} />
				{#if folder}
					<text x="5" y="13">{fit(c.d.name, c.w - 10)}</text>
				{:else if c.w > 30 && c.h > 16}
					<text x="5" y="13" style:fill={f?.text}>{fit(c.d.name, c.w - 10)}</text>
				{/if}
			</g>
		{/each}
	</svg>

	<div class="legend" aria-label="Color key">
		{#if ws.colorBy === 'lang'}
			{#each presentLangs as l (l)}
				<span class="key"><i style:background="var(--lang-{l})"></i>{LANG_NAMES[l]}</span>
			{/each}
		{:else if ws.colorBy === 'cycles'}
			<span class="key"><i style:background="var(--accent)"></i>In an import cycle</span>
			<span class="key"><i style:background="var(--neutral)"></i>Not in a cycle</span>
		{:else}
			{@const ramp = ws.colorBy === 'fanIn' ? FAN_IN_RAMP : FAN_OUT_RAMP}
			{@const max = ws.colorBy === 'fanIn' ? scales.maxFanIn : scales.maxFanOut}
			<span class="key">{ws.colorBy === 'fanIn' ? 'Times imported' : 'Imports made'}</span>
			<span class="ramp">
				<b>0</b>
				<i style:background="linear-gradient(90deg, {ramp[0]}, {ramp[1]})"></i>
				<b>{max}</b>
			</span>
		{/if}
		<span class="key muted">Area shows lines</span>
	</div>
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	.treemap {
		display: block;
	}

	.cell {
		cursor: pointer;
		outline: none;
	}

	.cell rect {
		stroke: var(--panel);
		stroke-width: 0.5;
	}

	.cell.folder rect {
		fill: var(--folder);
		stroke: var(--line);
		stroke-width: 1;
	}

	.cell.folder:hover > rect {
		stroke: var(--ink);
	}

	.cell:focus-visible > rect {
		stroke: var(--accent);
		stroke-width: 2;
	}

	.cell.sel > rect {
		stroke: var(--accent);
		stroke-width: 3;
	}

	.cell text {
		font-size: 11px;
		pointer-events: none;
	}

	.cell.folder text {
		fill: var(--ink);
		font-weight: 600;
	}

	.dim {
		opacity: 0.2;
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

	.key i {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}

	.muted {
		color: var(--muted);
	}

	.ramp {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.ramp i {
		width: 90px;
		height: 10px;
		border-radius: 2px;
	}

	.ramp b {
		font-family: var(--font-mono);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
</style>
