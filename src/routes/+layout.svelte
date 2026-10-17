<script lang="ts">
	import '../app.css';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import BrandMark from '#lib/ui/BrandMark.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Repograph</title>
</svelte:head>

<div class="app">
	<header class="top">
		<a class="brand" href={resolve('/')}>
			<BrandMark />
			<span class="wordmark">Repograph</span>
		</a>
	</header>
	{@render children()}
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 18px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ink);
		text-decoration: none;
	}

	.wordmark {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 20px;
		letter-spacing: -0.01em;
	}
</style>
