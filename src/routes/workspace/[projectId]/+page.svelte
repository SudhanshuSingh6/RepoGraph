<script lang="ts">
	import { resolve } from '$app/paths';
	import LoadingOverlay from '#lib/ui/LoadingOverlay.svelte';
	import Graph from '#lib/views/Graph.svelte';
	import GraphControls from '#lib/views/GraphControls.svelte';
	import Tree from '#lib/views/Tree.svelte';
	import TreeControls from '#lib/views/TreeControls.svelte';
	import Treemap from '#lib/views/Treemap.svelte';
	import TreemapControls from '#lib/views/TreemapControls.svelte';
	import Er from '#lib/views/Er.svelte';
	import Hotspots from '#lib/views/Hotspots.svelte';
	import Apis from '#lib/views/Apis.svelte';
	import ApisControls from '#lib/views/ApisControls.svelte';
	import ErControls from '#lib/views/ErControls.svelte';
	import Uml from '#lib/views/Uml.svelte';
	import UmlControls from '#lib/views/UmlControls.svelte';
	import { Workspace, type GraphPayload } from '#lib/workspace/state.svelte.ts';
	import Tip from '#lib/workspace/Tip.svelte';
	import ChatPanel from '#lib/workspace/ChatPanel.svelte';
	import SidePanel from '#lib/workspace/SidePanel.svelte';
	import Toolbar from '#lib/workspace/Toolbar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Status = typeof data.project & { summary: typeof data.summary };

	// Seeded from the server load, then kept fresh by polling until the import settles.
	// Keyed by project id so navigating to another project never shows stale polled data.
	let polled = $state<Status | null>(null);
	const current = $derived<Status>(
		polled?.id === data.project.id ? polled : { ...data.project, summary: data.summary }
	);

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

	// Once ready, the graph the views draw from (keyed by project, like `polled`).
	let loaded = $state<{ id: string; ws: Workspace } | null>(null);
	let graphError = $state<string | null>(null);
	const ws = $derived(loaded?.id === current.id ? loaded.ws : null);

	$effect(() => {
		if (current.status !== 'ready' || ws) return;
		const { id, name } = current;
		let cancelled = false;
		graphError = null;
		fetch(`/api/projects/${id}/graph`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`The graph couldn't be loaded (${res.status}).`);
				const payload: GraphPayload = await res.json();
				if (!cancelled) loaded = { id, ws: new Workspace(payload, name, id) };
			})
			.catch((e: Error) => {
				if (!cancelled) graphError = e.message;
			});
		return () => {
			cancelled = true;
		};
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

	{#if ws}
		<section class="workspace">
			<Toolbar {ws} />
			<div class="ctl">
				{#if ws.view === 'tree'}
					<TreeControls {ws} />
				{:else if ws.view === 'treemap'}
					<TreemapControls {ws} />
				{:else if ws.view === 'graph'}
					<GraphControls {ws} />
				{:else if ws.view === 'uml'}
					<UmlControls {ws} />
				{:else if ws.view === 'er'}
					<ErControls />
				{:else if ws.view === 'hotspots'}
					<span class="hint">Click a file to select it.</span>
				{:else if ws.view === 'apis'}
					<ApisControls {ws} />
				{/if}
			</div>
			<div class="main">
				<SidePanel {ws} />
				<div class="stage" role="tabpanel" aria-label="Active view">
					{#if ws.view === 'tree'}
						<Tree {ws} />
					{:else if ws.view === 'treemap'}
						<Treemap {ws} />
					{:else if ws.view === 'graph'}
						<Graph {ws} />
					{:else if ws.view === 'uml'}
						<Uml {ws} />
					{:else if ws.view === 'er'}
						<Er {ws} />
					{:else if ws.view === 'hotspots'}
						<Hotspots {ws} />
					{:else if ws.view === 'apis'}
						<Apis {ws} />
					{/if}
				</div>
				<ChatPanel {ws} available={data.chat.available} signedIn={data.chat.signedIn} />
			</div>
		</section>
		<Tip tip={ws.tip} />
	{:else if graphError}
		<section class="workspace">
			<div class="summary failed">
				<h2>Couldn't load the graph</h2>
				<p class="err">{graphError}</p>
			</div>
		</section>
	{:else}
		<section class="workspace"></section>
		<LoadingOverlay message="Building the graph…" />
	{/if}
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
		display: flex;
		flex-direction: column;
	}

	/* Per-view control bar (§15): its contents swap with the active tab. */
	.ctl {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 14px;
		min-height: 44px;
		padding: 7px 18px;
		background: var(--panel2);
		border-bottom: 1px solid var(--line);
	}

	.ctl :global(.btn) {
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 4px 12px;
		cursor: pointer;
	}

	.ctl :global(.btn:hover) {
		border-color: var(--ink);
	}

	.ctl :global(.field) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 600;
	}

	.ctl :global(select) {
		font: inherit;
		font-weight: 400;
		color: var(--ink);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 3px 6px;
	}

	.ctl :global(.hint) {
		margin-left: auto;
		font-size: 12.5px;
		font-style: italic;
		color: var(--muted);
	}

	/* §3: side panel | stage | chat panel. */
	.main {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 300px 1fr 380px;
	}

	.stage {
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	@media (max-width: 900px) {
		.workspace {
			overflow: auto;
		}

		.main {
			display: flex;
			flex-direction: column;
			flex: none;
		}

		.stage {
			order: 1;
			height: 62vh;
		}

		.main > :global(.side) {
			order: 2;
			border-right: none;
			border-top: 1px solid var(--line);
		}

		.main > :global(.chat-panel) {
			order: 3;
			height: 60vh;
			border-left: none;
			border-top: 1px solid var(--line);
		}
	}

	.summary {
		max-width: 520px;
		margin: 24px 18px;
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
