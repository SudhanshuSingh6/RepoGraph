<script lang="ts">
	// repograph-spec.md §12: ORM entities as field-list boxes, joined by relationships
	// labelled with their cardinality, on the same layered layout as the Architecture view.
	import type { EntityEdge } from '#analysis/types/index.ts';
	import { matchesSearch } from '#lib/workspace/filters.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import DiagramStage from './DiagramStage.svelte';
	import UmlBox from './UmlBox.svelte';
	import { placeBoxes } from './layout/placeBoxes.ts';
	import { erDiagram, fieldRows } from './erModel.ts';
	import { boxHeight } from './umlBoxSize.ts';

	let { ws }: { ws: Workspace } = $props();

	const PAD = 32; // DiagramStage's margin
	const MIN_WRAP = 600;
	const TITLE_PX = 8;
	const MONO_PX = 6.8;
	const ORM_NAMES = {
		jpa: 'JPA/Hibernate',
		typeorm: 'TypeORM',
		django: 'Django',
		sqlalchemy: 'SQLAlchemy'
	};

	let stageWidth = $state(0);

	$effect(() => ws.loadEntities());

	const diagram = $derived.by(() => {
		const entities = ws.entities;
		if (!entities) return null;
		const files = ws.graph.files;
		const m = erDiagram(entities, ws.relations, ws.active);
		const index = new Map(m.shown.map((e, i) => [e, i]));
		const items = m.shown.map((i) => {
			const e = entities[i];
			const path = files[e.file].path;
			const { rows, more } = fieldRows(e);
			const longest = Math.max(e.table.length, ...rows.map((r) => r.text.length), 10);
			return {
				key: String(i),
				entity: i,
				title: e.name,
				subtitle: e.table,
				rows,
				more,
				label: `${e.name}, ${ORM_NAMES[e.orm]} entity in ${path}`,
				tip: (ev: PointerEvent) =>
					ws.showTip(ev, `${path}:${e.line}`, [
						['Table', e.table],
						['ORM', ORM_NAMES[e.orm]],
						['Fields', e.fields.length.toLocaleString()],
						...e.relations.map((r) => [r.field, `${r.kind} ${r.target}`] as [string, string])
					]),
				w: Math.min(360, Math.max(160, e.name.length * TITLE_PX + 32, longest * MONO_PX + 24)),
				h: boxHeight(false, rows.length, more > 0)
			};
		});
		const arrows = m.edges.map((e: EntityEdge, k) => ({
			from: index.get(e.from)!,
			to: index.get(e.to)!,
			key: `${k}`,
			label: e.kind,
			title: `${entities[e.from].name}.${e.field} → ${entities[e.to].name} (${e.kind})`
		}));
		// The entity holding a relationship above the one it points at.
		return placeBoxes(
			items,
			arrows.map((a) => [a.from, a.to]),
			arrows,
			Math.max(MIN_WRAP, stageWidth - 2 * PAD)
		);
	});
</script>

<DiagramStage
	label="ER diagram"
	width={diagram?.width ?? 0}
	height={diagram?.height ?? 0}
	fitKey="er|{diagram?.boxes.length}"
	bind:stageWidth
>
	{#snippet defs()}
		<marker
			id="er-arrow"
			viewBox="0 -5 10 10"
			refX="10"
			markerWidth="8"
			markerHeight="8"
			markerUnits="userSpaceOnUse"
			orient="auto"
		>
			<path d="M0,-5L10,0L0,5" style:fill="var(--muted)" />
		</marker>
	{/snippet}

	{#if diagram}
		{#each diagram.lines as l (l.key)}
			<path class="rel" d={l.d} marker-end="url(#er-arrow)"><title>{l.title}</title></path>
		{/each}
		{#each diagram.boxes as b (b.key)}
			<UmlBox
				x={b.x}
				y={b.y}
				w={b.w}
				h={b.h}
				title={b.title}
				subtitle={b.subtitle}
				rows={b.rows}
				more={b.more}
				selected={ws.isSelectedEntity(b.entity)}
				dim={!matchesSearch(ws.graph.files[ws.entities![b.entity].file].path, ws.search)}
				label={b.label}
				onactivate={() => (ws.selection = { entity: b.entity })}
				ontip={b.tip}
				onleave={() => ws.hideTip()}
			/>
		{/each}
		<!-- Labels last, so no box covers one. -->
		{#each diagram.lines as l (l.key)}
			<text class="card" x={l.mid.x} y={l.mid.y}>{l.label}</text>
		{/each}
	{/if}

	{#snippet overlay()}
		{#if ws.entitiesError}
			<p class="uml-empty">{ws.entitiesError}</p>
		{:else if !ws.entities}
			<p class="uml-empty">Reading entities…</p>
		{:else if ws.entities.length === 0}
			<p class="uml-empty">
				No database entities were detected. The ER Diagram reads JPA/Hibernate, Django, SQLAlchemy
				and TypeORM models.
			</p>
		{:else if diagram && diagram.boxes.length === 0}
			<p class="uml-empty">No entities match the current filters.</p>
		{/if}
	{/snippet}
</DiagramStage>

<style>
	.rel {
		fill: none;
		stroke: var(--muted);
		stroke-width: 1.3;
	}

	.card {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		text-anchor: middle;
		dominant-baseline: middle;
		fill: var(--ink);
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 4px;
		stroke-linejoin: round;
		pointer-events: none;
	}
</style>
