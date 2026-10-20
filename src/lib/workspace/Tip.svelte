<script lang="ts">
	// repograph-spec.md §18: a floating tooltip that follows the cursor, clamped to the viewport.
	import type { Tip } from './state.svelte.ts';

	let { tip }: { tip: Tip | null } = $props();

	const GAP = 14;
	const EDGE = 8;
	let w = $state(0);
	let h = $state(0);
	let innerWidth = $state(0);
	let innerHeight = $state(0);

	// Below-right of the cursor; flipped to the other side when it would overflow.
	const left = $derived.by(() => {
		if (!tip) return 0;
		const x = tip.x + GAP + w > innerWidth - EDGE ? tip.x - GAP - w : tip.x + GAP;
		return Math.max(EDGE, x);
	});
	const top = $derived.by(() => {
		if (!tip) return 0;
		const y = tip.y + GAP + h > innerHeight - EDGE ? tip.y - GAP - h : tip.y + GAP;
		return Math.max(EDGE, y);
	});
</script>

<svelte:window bind:innerWidth bind:innerHeight />

{#if tip}
	<div
		class="tip"
		style:left="{left}px"
		style:top="{top}px"
		bind:clientWidth={w}
		bind:clientHeight={h}
	>
		<div class="title">{tip.title}</div>
		{#each tip.rows as [k, v] (k)}
			<div class="row"><span>{k}</span><b>{v}</b></div>
		{/each}
	</div>
{/if}

<style>
	.tip {
		position: fixed;
		z-index: 40;
		max-width: 360px;
		padding: 7px 10px;
		border-radius: 8px;
		background: #0e2b33;
		color: #e8f0ee;
		font-size: 12.5px;
		pointer-events: none;
		border: 1px solid rgba(220, 235, 232, 0.12);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
	}

	.title {
		font-family: var(--font-mono);
		word-break: break-all;
		margin-bottom: 3px;
	}

	.row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		color: #a9c0c3;
	}

	.row b {
		color: #e8f0ee;
		font-family: var(--font-mono);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
</style>
