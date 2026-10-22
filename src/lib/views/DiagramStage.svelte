<script lang="ts">
	// The zoomable, pannable SVG stage the Architecture and ER diagrams draw on. It fits a
	// diagram to the stage width whenever `fitKey` changes (not on every re-render).
	import { onMount, type Snippet } from 'svelte';
	import { select, zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3';

	let {
		label,
		width,
		height,
		fitKey,
		stageWidth = $bindable(0),
		defs,
		children,
		overlay
	}: {
		label: string;
		width: number; // the diagram's size, 0 when there's nothing to draw
		height: number;
		fitKey: string;
		stageWidth?: number;
		defs?: Snippet;
		children: Snippet;
		overlay?: Snippet; // HTML over the stage (empty and loading states)
	} = $props();

	const PAD = 32;

	let svg: SVGSVGElement;
	let stageHeight = $state(0);
	let transform = $state<ZoomTransform>(zoomIdentity);
	let z: ZoomBehavior<SVGSVGElement, unknown> | null = $state(null);

	onMount(() => {
		z = zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 3])
			.on('zoom', (e) => (transform = e.transform));
		select(svg).call(z);
	});

	let fitted = '';
	$effect(() => {
		if (!width || !z || !stageWidth || !stageHeight) return;
		const key = `${fitKey}|${stageWidth}x${stageHeight}`;
		if (key === fitted) return;
		fitted = key;
		// Fit the width (never enlarging); a diagram taller than the stage starts at its top
		// and pans down, rather than shrinking until its labels are unreadable.
		const k = Math.min(1, (stageWidth - 2 * PAD) / Math.max(width, 1));
		const t = zoomIdentity
			.translate((stageWidth - width * k) / 2, Math.max(PAD, (stageHeight - height * k) / 2))
			.scale(k);
		select(svg).call(z.transform, t);
	});
</script>

<div class="wrap" bind:clientWidth={stageWidth} bind:clientHeight={stageHeight}>
	<svg bind:this={svg} class="uml" role="img" aria-label={label}>
		<defs>{@render defs?.()}</defs>
		<g transform={transform.toString()}>{@render children()}</g>
	</svg>
	{@render overlay?.()}
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	.uml {
		display: block;
		width: 100%;
		height: 100%;
		cursor: grab;
		user-select: none;
	}

	.uml:active {
		cursor: grabbing;
	}

	.wrap :global(.uml-empty) {
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
</style>
