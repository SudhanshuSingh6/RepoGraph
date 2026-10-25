<script lang="ts">
	// An endpoint's control-flow chart over the whole window, with zoom and pan. It draws
	// the dropdown's own scene, so opening a call here opens it there too.
	import { onMount } from 'svelte';
	import { select, zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import FlowchartMinimap from './FlowchartMinimap.svelte';
	import FlowchartSvg from './FlowchartSvg.svelte';
	import {
		ZOOM_MAX,
		ZOOM_MIN,
		ZOOM_STEP,
		findMatches,
		fitTransform,
		startTransform,
		viewportRect,
		type Scene
	} from './layout/flowchartLayout.ts';

	let {
		ws,
		scene,
		n,
		label,
		method,
		route,
		handler,
		summary,
		onexpand,
		oncollapse,
		onclose
	}: {
		ws: Workspace;
		scene: Scene;
		n: number;
		label: string;
		method: string | null;
		route: string | null;
		handler: string;
		summary: string | null; // what Expand all left closed
		onexpand: () => void;
		oncollapse: () => void;
		onclose: () => void;
	} = $props();

	let dialog: HTMLDivElement;
	let svg: SVGSVGElement;
	let closeButton: HTMLButtonElement;
	let findBox: HTMLInputElement;
	let stageW = $state(0);
	let stageH = $state(0);
	let transform = $state<ZoomTransform>(zoomIdentity);
	let z: ZoomBehavior<SVGSVGElement, unknown> | null = $state(null);

	/** Shown under document.body, so no ancestor's stacking or overflow clips it. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	onMount(() => {
		z = zoom<SVGSVGElement, unknown>()
			.scaleExtent([ZOOM_MIN, ZOOM_MAX])
			.on('start', () => ws.hideTip())
			.on('zoom', (e) => (transform = e.transform));
		select(svg).call(z);
		closeButton.focus();
		const root = document.documentElement;
		const overflow = root.style.overflow;
		root.style.overflow = 'hidden';
		return () => {
			root.style.overflow = overflow;
			ws.hideTip();
		};
	});

	function apply(t: { k: number; x: number; y: number }) {
		if (z) select(svg).call(z.transform, zoomIdentity.translate(t.x, t.y).scale(t.k));
	}
	const fit = () => stageW && apply(fitTransform(scene.width, scene.height, stageW, stageH));
	const fitWidth = () => stageW && apply(startTransform(scene.width, scene.height, stageW, stageH));

	// The first view only: later the chart grows as calls open, and the view stays put.
	let started = false;
	$effect(() => {
		if (started || !z || !stageW || !stageH || !scene.width) return;
		started = true;
		fitWidth();
	});

	// At the zoom floor with the chart still bigger than the stage: say so.
	const tooBig = $derived(
		transform.k <= ZOOM_MIN + 1e-9 &&
			(scene.width * transform.k > stageW || scene.height * transform.k > stageH)
	);

	// Find in chart: matches in the drawn scene; the view moves to the current one.
	let query = $state('');
	let at = $state(0);
	const found = $derived(findMatches(scene, query));
	const matchSet = $derived(new Set(found));
	const current = $derived(found.length ? found[Math.min(at, found.length - 1)] : null);

	function show(i: number) {
		if (!found.length) return;
		at = (i + found.length) % found.length;
		const s = scene.shapes.find((x) => x.id === found[at]);
		if (!s || s.type === 'dot') return;
		const k = transform.k < 0.6 ? 1 : transform.k;
		apply({ k, x: stageW / 2 - (s.x + s.w / 2) * k, y: stageH / 2 - (s.y + s.h / 2) * k });
	}

	// The overview, unless switched off (remembered in this browser) or the whole chart
	// is already in view.
	const MAP_KEY = 'repograph.flowchartMap';
	let mapOn = $state(readMapOn());
	function readMapOn() {
		try {
			return localStorage.getItem(MAP_KEY) !== 'off';
		} catch {
			return true;
		}
	}
	function toggleMap() {
		mapOn = !mapOn;
		try {
			localStorage.setItem(MAP_KEY, mapOn ? 'on' : 'off');
		} catch {
			// not remembered; still toggled for now
		}
	}
	const allVisible = $derived.by(() => {
		const v = viewportRect(transform, stageW, stageH);
		return v.x <= 0 && v.y <= 0 && v.x + v.w >= scene.width && v.y + v.h >= scene.height;
	});

	const zoomBy = (f: number) => z && select(svg).call(z.scaleBy, f);
	const actual = () => z && select(svg).call(z.scaleTo, 1);

	function onkeydown(e: KeyboardEvent) {
		if (e.target === findBox) {
			// Typing in Find: its own keys; the zoom keys don't apply.
			if (e.key === 'Escape') {
				e.preventDefault();
				if (query) query = '';
				else onclose();
			} else if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				show(at + (e.shiftKey || e.key === 'ArrowUp' ? -1 : 1));
			}
			if (e.key !== 'Tab') return;
		}
		if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
			e.preventDefault();
			findBox.focus();
			findBox.select();
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
			return;
		}
		if (e.key === 'Tab') {
			// Keep focus inside the dialog.
			const items = [
				...dialog.querySelectorAll<HTMLElement | SVGElement>('button, input, [tabindex="0"]')
			];
			if (!items.length) return;
			const first = items[0];
			const last = items[items.length - 1];
			const at = document.activeElement;
			if (e.shiftKey && (at === first || !dialog.contains(at))) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && (at === last || !dialog.contains(at))) {
				e.preventDefault();
				first.focus();
			}
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP);
		else if (e.key === '-') zoomBy(1 / ZOOM_STEP);
		else if (e.key === '0') fit();
		else if (e.key === '1') actual();
		else if (e.key === 'w') fitWidth();
		else return;
		e.preventDefault();
	}

	const methodClass = (m: string) =>
		m === 'GET'
			? 'get'
			: m === 'POST'
				? 'post'
				: m === 'PUT' || m === 'PATCH'
					? 'put'
					: m === 'DELETE'
						? 'delete'
						: 'other';
</script>

<svelte:window {onkeydown} />

<div
	class="overlay"
	use:portal
	bind:this={dialog}
	role="dialog"
	aria-modal="true"
	aria-label="Flowchart of {label}"
>
	<div class="top">
		<span class="what">
			{#if method}<span class="method {methodClass(method)}">{method}</span>{/if}
			{#if route}<span class="route" title={route}>{route}</span>{/if}
			<span class="handler" title={handler}>{handler}</span>
		</span>
		<span class="tools">
			<span class="group" role="group" aria-label="Zoom">
				<button
					type="button"
					class="btn"
					aria-label="Zoom out"
					title="Zoom out (−)"
					onclick={() => zoomBy(1 / ZOOM_STEP)}>−</button
				>
				<span class="pct" aria-live="polite">{Math.round(transform.k * 100)}%</span>
				<button
					type="button"
					class="btn"
					aria-label="Zoom in"
					title="Zoom in (+)"
					onclick={() => zoomBy(ZOOM_STEP)}>+</button
				>
				<button type="button" class="btn" title="Fit to screen (0)" onclick={fit}
					>Fit to screen</button
				>
				<button type="button" class="btn" title="Fit width (w)" onclick={fitWidth}>Fit width</button
				>
				<button type="button" class="btn" title="Actual size (1)" onclick={actual}>100%</button>
			</span>
			<span class="group find" role="search">
				<input
					bind:this={findBox}
					value={query}
					oninput={(e) => {
						query = e.currentTarget.value;
						show(0);
					}}
					type="search"
					placeholder="Find in chart (/)"
					aria-label="Find in chart"
				/>
				<span class="count" aria-live="polite"
					>{query.trim() ? (found.length ? `${at + 1} of ${found.length}` : 'none') : ''}</span
				>
				<button
					type="button"
					class="btn"
					aria-label="Previous match"
					disabled={!found.length}
					onclick={() => show(at - 1)}>↑</button
				>
				<button
					type="button"
					class="btn"
					aria-label="Next match"
					disabled={!found.length}
					onclick={() => show(at + 1)}>↓</button
				>
			</span>
			<span class="group">
				<button type="button" class="btn" onclick={onexpand}>Expand all calls</button>
				<button type="button" class="btn" onclick={oncollapse}>Collapse all calls</button>
				<button type="button" class="btn" aria-pressed={mapOn} onclick={toggleMap}
					>{mapOn ? 'Hide map' : 'Show map'}</button
				>
			</span>
			<button type="button" class="btn close" bind:this={closeButton} onclick={onclose}
				>✕ Close</button
			>
		</span>
	</div>
	{#if query.trim() || summary || tooBig}
		<div class="notes">
			{#if query.trim()}<span>Searches the drawn chart; closed calls aren't searched.</span>{/if}
			{#if summary}<span>{summary}</span>{/if}
			{#if tooBig}
				<span
					>Chart is wider than the screen at the minimum zoom; drag or use the map to see the rest.</span
				>
			{/if}
		</div>
	{/if}
	<div class="stage" bind:clientWidth={stageW} bind:clientHeight={stageH}>
		<svg bind:this={svg} role="img" aria-label="Control-flow chart of {handler}">
			<g transform={transform.toString()}>
				<FlowchartSvg {ws} {scene} marker="fc-arrow-{n}-full" matches={matchSet} {current} />
			</g>
		</svg>
		{#if mapOn && !allVisible && stageW}
			<FlowchartMinimap {scene} {transform} {stageW} {stageH} matches={matchSet} onjump={apply} />
		{/if}
	</div>
	<p class="hint">
		Scroll or pinch to zoom, drag to pan, or use the map. Keys: + / − zoom, 0 fit to screen, w fit
		width, 1 actual size, / find, Esc close.
	</p>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 35; /* over the app; under the hover tip (40) */
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--ink);
	}

	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
		padding: 8px 16px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}

	.what {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.route,
	.handler {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 12.5px;
	}

	.route {
		font-weight: 700;
	}

	.handler {
		color: var(--muted);
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}

	.group {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.find input {
		width: 170px;
		font: inherit;
		font-size: 12px;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 3px 10px;
	}

	.count {
		min-width: 48px;
		font-size: 11.5px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.notes {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		padding: 4px 16px;
		font-size: 11.5px;
		color: var(--muted);
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}

	.pct {
		min-width: 44px;
		text-align: center;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}

	.btn {
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 3px 10px;
		cursor: pointer;
	}

	.close {
		border-color: var(--ink);
	}

	.stage {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		background: var(--panel2);
	}

	svg {
		display: block;
		width: 100%;
		height: 100%;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}

	svg:active {
		cursor: grabbing;
	}

	.hint {
		margin: 0;
		padding: 4px 16px;
		font-size: 11.5px;
		color: var(--muted);
		background: var(--panel);
		border-top: 1px solid var(--line);
	}

	.method {
		--c: var(--muted);
		min-width: 52px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
		border-radius: 4px;
		padding: 1px 6px;
	}

	.method.get {
		--c: var(--lang-ts);
	}

	.method.post {
		--c: var(--lang-py);
	}

	.method.put {
		--c: var(--lang-java);
	}

	.method.delete {
		--c: var(--accent);
	}
</style>
