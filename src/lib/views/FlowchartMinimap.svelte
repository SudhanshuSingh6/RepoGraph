<script lang="ts">
	// The full-screen chart's overview: every shape as a plain rectangle, the visible area
	// as a frame, Find matches in the accent colour. Click or drag to move the view there.
	import {
		mapFrame,
		minimapToTransform,
		viewportRect,
		type Scene
	} from './layout/flowchartLayout.ts';

	let {
		scene,
		transform,
		stageW,
		stageH,
		matches,
		onjump
	}: {
		scene: Scene;
		transform: { k: number; x: number; y: number };
		stageW: number;
		stageH: number;
		matches: Set<string>;
		onjump: (t: { k: number; x: number; y: number }) => void;
	} = $props();

	const MAX_W = 200;
	const MAX_H = 160;

	// The box shrinks to the chart's proportions, so little of it is margin.
	const map = $derived.by(() => {
		const s = Math.min(MAX_W / Math.max(scene.width, 1), MAX_H / Math.max(scene.height, 1));
		return mapFrame(scene.width, scene.height, scene.width * s, scene.height * s);
	});
	const view = $derived(viewportRect(transform, stageW, stageH));
	const solid = $derived(scene.shapes.filter((s) => s.type !== 'dot' && s.type !== 'region'));

	let svg: SVGSVGElement;
	let dragging = false;

	function jump(e: PointerEvent) {
		const r = svg.getBoundingClientRect();
		onjump(
			minimapToTransform(e.clientX - r.left, e.clientY - r.top, map, transform.k, stageW, stageH)
		);
	}
</script>

<svg
	bind:this={svg}
	class="map"
	width={map.w}
	height={map.h}
	role="img"
	aria-label="Overview of the chart; click or drag to move the view"
	onpointerdown={(e) => {
		dragging = true;
		svg.setPointerCapture(e.pointerId);
		jump(e);
	}}
	onpointermove={(e) => dragging && jump(e)}
	onpointerup={() => (dragging = false)}
	onpointercancel={() => (dragging = false)}
>
	<g transform="translate({map.ox},{map.oy}) scale({map.s})">
		{#each solid as s (s.id)}
			<rect class={s.type} class:hit={matches.has(s.id)} x={s.x} y={s.y} width={s.w} height={s.h} />
		{/each}
		<rect class="view" x={view.x} y={view.y} width={view.w} height={view.h} />
	</g>
</svg>

<style>
	.map {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: block;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 6px;
		cursor: pointer;
		touch-action: none;
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
	}

	rect {
		vector-effect: non-scaling-stroke;
	}

	.frame {
		fill: none;
		stroke: var(--line);
	}

	.box,
	.diamond,
	.pill {
		fill: var(--muted);
		opacity: 0.55;
	}

	.hit {
		fill: var(--accent);
		opacity: 1;
	}

	.view {
		fill: color-mix(in srgb, var(--ink) 8%, transparent);
		stroke: var(--ink);
		stroke-width: 1.5;
	}
</style>
