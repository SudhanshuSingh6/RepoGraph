<script lang="ts">
	// A UML-style box (repograph-spec.md §11/§12): italic stereotype, bold title, mono
	// subtitle. Shared by the component, class and ER diagrams.
	let {
		x,
		y,
		w,
		h,
		title,
		stereotype = null,
		subtitle = null,
		faded = false,
		selected = false,
		accent = false,
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
		faded?: boolean;
		selected?: boolean;
		accent?: boolean;
		label: string;
		onactivate: () => void;
		ontip: (e: PointerEvent) => void;
		onleave: () => void;
	} = $props();

	const STEREO_H = 16;
	const top = $derived(stereotype ? STEREO_H + 8 : 8);
</script>

<g
	class="box"
	class:faded
	class:sel={selected}
	class:accent
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

	.sub {
		font-family: var(--font-mono);
		font-size: 11px;
		fill: var(--muted);
	}
</style>
