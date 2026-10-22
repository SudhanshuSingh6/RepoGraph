<script lang="ts">
	// A UML-style box (repograph-spec.md §11/§12): italic stereotype, bold title, mono
	// subtitle and, for ER entities, a field list. Shared by the component, class and ER
	// diagrams; `boxHeight` sizes one.
	import { FIELD_ROW, boxHeight } from './umlBoxSize.ts';
	let {
		x,
		y,
		w,
		h,
		title,
		stereotype = null,
		subtitle = null,
		rows = [],
		more = 0,
		faded = false,
		selected = false,
		accent = false,
		dim = false,
		label,
		onactivate,
		ontip,
		onleave
	}: {
		x: number;
		y: number;
		w: number;
		h: number;
		title: string;
		stereotype?: string | null;
		subtitle?: string | null;
		rows?: { text: string; bold: boolean }[];
		more?: number;
		faded?: boolean;
		selected?: boolean;
		accent?: boolean;
		dim?: boolean; // not matching the search box
		label: string;
		onactivate: () => void;
		ontip: (e: PointerEvent) => void;
		onleave: () => void;
	} = $props();

	const STEREO_H = 16;
	const top = $derived(stereotype ? STEREO_H + 8 : 8);
	const divider = $derived(boxHeight(stereotype !== null, 0, false) - 8);
</script>

<g
	class="box"
	class:faded
	class:sel={selected}
	class:accent
	class:dim
	transform="translate({x},{y})"
	role="button"
	tabindex="0"
	aria-label={label}
	onclick={(e) => {
		e.stopPropagation();
		onactivate();
	}}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onactivate();
		}
	}}
	onpointermove={ontip}
	onpointerleave={onleave}
>
	<rect width={w} height={h} rx="6" />
	{#if stereotype}
		<text class="stereo" x={w / 2} y="18">{stereotype}</text>
	{/if}
	<text class="title" x={w / 2} y={top + 14}>{title}</text>
	{#if subtitle}
		<text class="sub" x={w / 2} y={top + 31}>{subtitle}</text>
	{/if}
	{#if rows.length || more}
		<line class="div" x1="0" x2={w} y1={divider} y2={divider} />
		{#each rows as r, i (i)}
			<text class="row" class:pk={r.bold} x="10" y={divider + FIELD_ROW * (i + 1) - 3}>
				{r.text}
			</text>
		{/each}
		{#if more}
			<text class="row more" x="10" y={divider + FIELD_ROW * (rows.length + 1) - 3}>
				+{more} more
			</text>
		{/if}
	{/if}
</g>

<style>
	.box {
		cursor: pointer;
		outline: none;
	}

	rect {
		fill: var(--panel);
		stroke: var(--line);
		stroke-width: 1.2;
	}

	.box:hover rect,
	.box:focus-visible rect {
		stroke: var(--ink);
	}

	.box.accent rect {
		stroke: var(--accent);
	}

	.box.sel rect {
		stroke: var(--accent);
		stroke-width: 3;
	}

	.box.faded {
		opacity: 0.45;
	}

	.box.dim {
		opacity: 0.28;
	}

	.box.faded rect {
		stroke-dasharray: 4 3;
	}

	text {
		text-anchor: middle;
		fill: var(--ink);
		pointer-events: none;
	}

	.stereo {
		font-size: 11px;
		font-style: italic;
		fill: var(--muted);
	}

	.title {
		font-size: 13.5px;
		font-weight: 700;
	}

	.div {
		stroke: var(--line);
	}

	.row {
		text-anchor: start;
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.row.pk {
		font-weight: 700;
	}

	.row.more {
		fill: var(--muted);
		font-style: italic;
	}

	.sub {
		font-family: var(--font-mono);
		font-size: 11px;
		fill: var(--muted);
	}
</style>
