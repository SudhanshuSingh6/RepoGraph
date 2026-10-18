<script lang="ts">
	import { resolve } from '$app/paths';
	import LoadingOverlay from '#lib/ui/LoadingOverlay.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Status = typeof data.project & { summary: typeof data.summary };

	// Seeded from the server load, then kept fresh by polling until the import settles.
	// Keyed by project id so navigating to another project never shows stale polled data.
	let polled = $state<Status | null>(null);
	const current = $derived<Status>(
		polled?.id === data.project.id ? polled : { ...data.project, summary: data.summary }
	);

	const LANG_NAMES: Record<string, string> = {
		java: 'Java',
		js: 'JavaScript',
		ts: 'TypeScript',
		py: 'Python'
	};
	const POLL_MS = 1000;

	const settled = $derived(current.status === 'ready' || current.status === 'error');
	const progressMessage = $derived.by(() => {
		switch (current.status) {
			case 'pending':
				return 'Waiting for the parser…';
			case 'cloning':
				return current.github
					? `Cloning ${current.github.owner}/${current.github.repo}…`
					: 'Unpacking archive…';
			default:
				return 'Reading files…';
		}
	});

	$effect(() => {
		if (settled) return;
		const timer = setInterval(async () => {
			const res = await fetch(`/api/projects/${current.id}/status`);
			if (res.ok) polled = await res.json();
		}, POLL_MS);
		return () => clearInterval(timer);
	});

	const fmt = (n: number) => n.toLocaleString();
</script>

<svelte:head>
	<title>{current.name} · Repograph</title>
</svelte:head>

{#if current.status === 'ready' && current.summary}
	<div class="stats" aria-label="Repository stats">
		<span class="repo">{current.name}</span>
		<span class="stat"><b>{fmt(current.summary.files)}</b> files</span>
		<span class="stat"><b>{fmt(current.summary.lines)}</b> lines</span>
		<span class="stat"><b>{fmt(current.summary.imports)}</b> imports</span>
		{#if current.skippedLargeFiles > 0}
			<span class="stat warn">
				{current.skippedLargeFiles}
				{current.skippedLargeFiles === 1 ? 'large file skipped' : 'large files skipped'}
			</span>
		{/if}
	</div>

	<section class="workspace">
		<div class="summary">
			<h2>Languages</h2>
			<div class="bar" role="img" aria-label="Lines of code by language">
				{#each current.summary.languages as l (l.lang)}
					<span
						style:width="{(l.lines / Math.max(current.summary.lines, 1)) * 100}%"
						style:background="var(--lang-{l.lang})"
					></span>
				{/each}
			</div>
			<ul>
				{#each current.summary.languages as l (l.lang)}
					<li class="lrow">
						<i style:background="var(--lang-{l.lang})"></i>
						<span>{LANG_NAMES[l.lang] ?? l.lang}</span>
						<span class="num">{fmt(l.files)} files</span>
						<span class="num">{fmt(l.lines)} lines</span>
					</li>
				{/each}
			</ul>
			<p class="fine">The six views arrive in the next build phases.</p>
		</div>
	</section>
{:else if current.status === 'error'}
	<section class="workspace">
		<div class="summary failed">
			<h2>Import failed</h2>
			<p class="err">{current.errorMessage ?? 'The import failed.'}</p>
			<a class="btn" href={resolve('/')}>Try another project</a>
		</div>
	</section>
{:else}
	<section class="workspace"></section>
	<LoadingOverlay message={progressMessage} />
{/if}

<style>
	.stats {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px 18px;
		padding: 8px 18px;
		background: var(--panel2);
		border-bottom: 1px solid var(--line);
	}

	.repo {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
	}

	.stat {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.stat b {
		color: var(--ink);
		font-family: var(--font-mono);
	}

	.stat.warn {
		color: var(--accent);
		font-weight: 600;
	}

	.workspace {
		flex: 1;
		min-height: 0;
		padding: 24px 18px;
	}

	.summary {
		max-width: 520px;
		padding: 20px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
	}

	h2 {
		margin: 0 0 12px;
		font-family: var(--font-display);
		font-size: 18px;
	}

	.bar {
		display: flex;
		height: 10px;
		border-radius: 999px;
		overflow: hidden;
		background: var(--panel2);
	}

	ul {
		list-style: none;
		margin: 14px 0 0;
		padding: 0;
	}

	.lrow {
		display: grid;
		grid-template-columns: 12px 1fr auto auto;
		align-items: center;
		gap: 10px;
		padding: 4px 0;
	}

	.lrow i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--muted);
		text-align: right;
	}

	.fine {
		margin: 14px 0 0;
		font-size: 12.5px;
		color: var(--muted);
	}

	.err {
		color: var(--accent);
		font-weight: 600;
	}

	.btn {
		display: inline-block;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 6px 14px;
		text-decoration: none;
	}
</style>
