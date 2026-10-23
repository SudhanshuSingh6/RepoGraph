<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The row whose Delete is waiting for confirmation, and the one being deleted.
	let confirming = $state<string | null>(null);
	let deleting = $state<string | null>(null);

	const fmt = (n: number) => n.toLocaleString();
	const date = (d: Date) =>
		d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
</script>

<svelte:head>
	<title>Your projects · Repograph</title>
</svelte:head>

<main class="projects">
	{#if data.projects === null}
		<section class="empty">
			<h1>Your projects</h1>
			<p>Sign in with GitHub to keep the projects you import.</p>
			<a class="btn primary" href={resolve('/auth/github')} data-sveltekit-reload>
				Sign in with GitHub
			</a>
		</section>
	{:else}
		<div class="head">
			<h1>Your projects</h1>
			<a class="btn" href={resolve('/')}>Import another</a>
		</div>
		{#if data.projects.length === 0}
			<section class="empty">
				<p>No projects yet.</p>
				<a class="btn primary" href={resolve('/')}>Import a project</a>
			</section>
		{:else}
			<ul class="list">
				{#each data.projects as p (p.id)}
					<li class="row" class:busy={deleting === p.id} class:asking={confirming === p.id}>
						<div class="main">
							<a class="name" href={resolve('/workspace/[projectId]', { projectId: p.id })}>
								{p.name}
							</a>
							<span class="source">
								{p.source === 'github'
									? `github.com/${p.githubOwner}/${p.githubRepo}`
									: 'Uploaded archive'}
							</span>
						</div>
						<span class="when">
							{#if p.status === 'error'}
								<span class="failed">Import failed</span>
							{:else if p.parsedAt && p.status === 'ready'}
								Imported {date(p.parsedAt)}
							{:else}
								Importing…
							{/if}
						</span>
						<span class="files">{fmt(p.files)} {p.files === 1 ? 'file' : 'files'}</span>
						<form
							method="post"
							action="?/delete"
							class="actions"
							use:enhance={() => {
								deleting = p.id;
								return async ({ update }) => {
									await update();
									deleting = null;
									confirming = null;
								};
							}}
						>
							<input type="hidden" name="projectId" value={p.id} />
							{#if confirming === p.id}
								<span class="ask">Delete {p.name}? This removes its parsed data.</span>
								<button class="btn danger" type="submit" disabled={deleting === p.id}>
									Delete
								</button>
								<button class="btn" type="button" onclick={() => (confirming = null)}>
									Cancel
								</button>
							{:else}
								<!-- Without JavaScript this submits straight away; with it, it asks first. -->
								<button
									class="btn"
									type="submit"
									onclick={(e) => {
										e.preventDefault();
										confirming = p.id;
									}}
								>
									Delete
								</button>
							{/if}
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>

<style>
	.projects {
		width: 100%;
		max-width: 900px;
		margin: 0 auto;
		padding: 28px 18px 48px;
		overflow: auto;
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 26px;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 18px;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		align-items: center;
		gap: 18px;
		padding: 14px 18px;
		border-top: 1px solid var(--line);
	}

	.row:first-child {
		border-top: none;
	}

	/* The confirmation gets a line of its own, so the row keeps its name readable. */
	.row.asking .actions {
		grid-column: 1 / -1;
		justify-content: flex-end;
	}

	.row.busy {
		opacity: 0.5;
	}

	.main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.name {
		font-weight: 700;
		color: var(--ink);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name:hover {
		color: var(--accent);
	}

	.source {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.when,
	.files {
		font-size: 13px;
		color: var(--muted);
		white-space: nowrap;
	}

	.files {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.failed {
		color: var(--accent);
		font-weight: 600;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		margin: 0;
	}

	.ask {
		font-size: 13px;
	}

	.btn {
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 5px 14px;
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
	}

	.btn:hover {
		border-color: var(--ink);
	}

	.btn.primary {
		color: var(--panel);
		background: var(--ink);
		border-color: var(--ink);
	}

	.btn.danger {
		color: var(--panel);
		background: var(--accent);
		border-color: var(--accent);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
		padding: 18px 0;
		color: var(--muted);
	}

	.empty p {
		margin: 0;
	}

	@media (max-width: 640px) {
		.row {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.actions {
			grid-column: 1 / -1;
			flex-wrap: wrap;
			justify-content: flex-start;
		}
	}
</style>
