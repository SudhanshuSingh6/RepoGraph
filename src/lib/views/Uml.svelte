<script lang="ts">
	// repograph-spec.md §11: component diagram (packages, layered by import depth), and a
	// class diagram for any package.
	import { resolveSupertypes } from '#analysis/types/index.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import DiagramStage from './DiagramStage.svelte';
	import UmlBox from './UmlBox.svelte';
	import type { DagEdge, Placed, Size } from './layout/layeredDag.ts';
	import { placeBoxes } from './layout/placeBoxes.ts';
	import { boxHeight } from './umlBoxSize.ts';
	import { STEREOTYPE, classDiagram, componentDiagram } from './umlModel.ts';

	let { ws }: { ws: Workspace } = $props();

	const PAD = 32; // DiagramStage's margin
	const MIN_WRAP = 600; // rows wrap at the stage width, but never narrower than this
	const TITLE_PX = 8; // rough width per 13.5px bold character
	const MONO_PX = 6.8; // per 11px mono character

	type Box = Placed &
		Size & {
			key: string;
			title: string;
			stereotype: string | null;
			subtitle: string;
			faded: boolean;
			selected: boolean;
			accent: boolean;
			label: string;
			activate: () => void;
			tip: (e: PointerEvent) => void;
		};
	type Arrow = { kind: 'import' | 'cycle' | 'extends' | 'implements' };

	let stageWidth = $state(0);

	$effect(() => ws.loadTypes());

	const typeEdges = $derived(
		ws.types ? resolveSupertypes(ws.types, ws.graph.files, ws.full.adj) : []
	);

	const sizeFor = (title: string, subtitle: string, stereo: boolean): Size => ({
		w: Math.min(340, Math.max(150, title.length * TITLE_PX + 32, subtitle.length * MONO_PX + 28)),
		h: boxHeight(stereo, 0, false)
	});

	/** `layout` edges are [above, below] pairs, `arrows` what gets drawn. */
	const place = (
		items: Omit<Box, 'x' | 'y'>[],
		layout: DagEdge[],
		arrows: { from: number; to: number; key: string; kind: Arrow['kind'] }[]
	) => placeBoxes(items, layout, arrows, Math.max(MIN_WRAP, stageWidth - 2 * PAD));

	const fmt = (n: number) => n.toLocaleString();

	const diagram = $derived.by(() => {
		const files = ws.graph.files;
		if (ws.umlFolder === null) {
			const m = componentDiagram(files, ws.derived, ws.umlLevel);
			const index = new Map(m.nodes.map((n, i) => [n.id, i]));
			const items = m.nodes.map((n) => {
				const subtitle = `${fmt(n.files.length)} ${n.files.length === 1 ? 'file' : 'files'} · ${fmt(n.loc)} lines`;
				return {
					key: n.id,
					title: n.label,
					stereotype: null,
					subtitle,
					faded: false,
					selected: false,
					accent: n.inCycle,
					label: `${n.id}, open class diagram`,
					activate: () => (ws.umlFolder = n.id),
					tip: (e: PointerEvent) =>
						ws.showTip(e, n.id, [
							['Files', fmt(n.files.length)],
							['Lines', fmt(n.loc)]
						]),
					...sizeFor(n.label, subtitle, false)
				};
			});
			const edges = m.links.map((l) => ({
				from: index.get(l.source)!,
				to: index.get(l.target)!,
				key: l.id,
				kind: (l.cycle ? 'cycle' : 'import') as Arrow['kind']
			}));
			// Importers above what they import.
			return place(
				items,
				edges.map((e) => [e.from, e.to]),
				edges
			);
		}

		if (!ws.types) return null;
		const c = classDiagram(ws.types, typeEdges, files, ws.active, ws.umlLevel, ws.umlFolder);
		const index = new Map(c.boxes.map((b, i) => [b.type, i]));
		const items = c.boxes.map(({ type, external }) => {
			const t = ws.types![type];
			const path = files[t.file].path;
			const subtitle = external
				? path.slice(0, path.lastIndexOf('/'))
				: path.slice(path.lastIndexOf('/') + 1);
			return {
				key: String(type),
				title: t.name,
				stereotype: STEREOTYPE[t.kind],
				subtitle,
				faded: external,
				selected: ws.isSelectedFile(t.file),
				accent: false,
				label: `${t.name}, ${t.kind} in ${path}`,
				activate: () => (ws.selection = { file: t.file }),
				tip: (e: PointerEvent) =>
					ws.showTip(e, `${path}:${t.line}`, [
						['Kind', t.kind],
						...(t.extends.length
							? ([['Extends', t.extends.join(', ')]] as [string, string][])
							: []),
						...(t.implements.length
							? ([['Implements', t.implements.join(', ')]] as [string, string][])
							: [])
					]),
				...sizeFor(t.name, subtitle, STEREOTYPE[t.kind] !== null)
			};
		});
		const edges = c.edges.map((e) => ({
			from: index.get(e.child)!,
			to: index.get(e.parent)!,
			key: `${e.child}-${e.parent}-${e.kind}`,
			kind: e.kind as Arrow['kind']
		}));
		// Supertypes above their subtypes (UML convention): layer on the reversed arrows.
		return place(
			items,
			edges.map((e) => [e.to, e.from]),
			edges
		);
	});
</script>

<DiagramStage
	label="Architecture diagram"
	width={diagram?.width ?? 0}
	height={diagram?.height ?? 0}
	fitKey="{ws.umlFolder}|{ws.umlLevel}|{diagram?.boxes.length}"
	bind:stageWidth
>
	{#snippet defs()}
		<marker
			id="uml-arrow"
			viewBox="0 -5 10 10"
			refX="10"
			markerWidth="8"
			markerHeight="8"
			markerUnits="userSpaceOnUse"
			orient="auto"
		>
			<path d="M0,-5L10,0L0,5" style:fill="var(--muted)" />
		</marker>
		<marker
			id="uml-arrow-cycle"
			viewBox="0 -5 10 10"
			refX="10"
			markerWidth="8"
			markerHeight="8"
			markerUnits="userSpaceOnUse"
			orient="auto"
		>
			<path d="M0,-5L10,0L0,5" style:fill="var(--accent)" />
		</marker>
		<!-- UML generalization / realization: a hollow triangle at the supertype. -->
		<marker
			id="uml-triangle"
			viewBox="0 -6 12 12"
			refX="12"
			markerWidth="14"
			markerHeight="14"
			markerUnits="userSpaceOnUse"
			orient="auto"
		>
			<path
				d="M0,-6L12,0L0,6Z"
				style:fill="var(--panel)"
				style:stroke="var(--ink)"
				stroke-width="1.2"
			/>
		</marker>
	{/snippet}

	{#if diagram}
		{#each diagram.lines as l (l.key)}
			<path
				class="arrow {l.kind}"
				d={l.d}
				marker-end={l.kind === 'extends' || l.kind === 'implements'
					? 'url(#uml-triangle)'
					: l.kind === 'cycle'
						? 'url(#uml-arrow-cycle)'
						: 'url(#uml-arrow)'}
			/>
		{/each}
		{#each diagram.boxes as b (b.key)}
			<UmlBox
				x={b.x}
				y={b.y}
				w={b.w}
				h={b.h}
				title={b.title}
				stereotype={b.stereotype}
				subtitle={b.subtitle}
				faded={b.faded}
				selected={b.selected}
				accent={b.accent}
				label={b.label}
				onactivate={b.activate}
				ontip={b.tip}
				onleave={() => ws.hideTip()}
			/>
		{/each}
	{/if}

	{#snippet overlay()}
		{#if ws.umlFolder !== null && ws.typesError}
			<p class="uml-empty">{ws.typesError}</p>
		{:else if ws.umlFolder !== null && !ws.types}
			<p class="uml-empty">Reading classes…</p>
		{:else if diagram && diagram.boxes.length === 0}
			<p class="uml-empty">
				{ws.umlFolder === null
					? 'No files match the current filters.'
					: 'No classes or interfaces were found in this package.'}
			</p>
		{/if}
	{/snippet}
</DiagramStage>

<style>
	.arrow {
		fill: none;
		stroke: var(--muted);
		stroke-width: 1.3;
	}

	.arrow.cycle {
		stroke: var(--accent);
		stroke-width: 1.8;
	}

	.arrow.extends,
	.arrow.implements {
		stroke: var(--ink);
	}

	.arrow.implements {
		stroke-dasharray: 6 4;
	}
</style>
