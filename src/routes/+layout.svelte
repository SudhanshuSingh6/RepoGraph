<script lang="ts">
	import '../app.css';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import BrandMark from '#lib/ui/BrandMark.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
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
		<div class="account">
			{#if data.user}
				{#if data.user.avatarUrl}
					<img class="avatar" src={data.user.avatarUrl} alt="" width="24" height="24" />
				{/if}
				<span class="username">{data.user.username}</span>
				<form method="post" action={resolve('/auth/logout')}>
					<button class="btn" type="submit">Log out</button>
				</form>
			{:else}
				<a class="btn" href={resolve('/auth/github')} data-sveltekit-reload>Sign in with GitHub</a>
			{/if}
		</div>
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

	.account {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-left: auto;
	}

	.account form {
		margin: 0;
	}

	.avatar {
		border-radius: 50%;
		border: 1px solid var(--line);
	}

	.username {
		font-weight: 600;
	}

	.btn {
		font: inherit;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 5px 14px;
		cursor: pointer;
		text-decoration: none;
	}

	.btn:hover {
		border-color: var(--ink);
	}

	.wordmark {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 20px;
		letter-spacing: -0.01em;
	}
</style>
