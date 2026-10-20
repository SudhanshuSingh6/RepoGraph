<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import HeroGraph from '#lib/ui/HeroGraph.svelte';
	import LoadingOverlay from '#lib/ui/LoadingOverlay.svelte';
	import {
		ImportError,
		filesFromDrop,
		filesFromInput,
		importFromGithub,
		importSample,
		uploadArchive,
		zipFiles
	} from '#lib/import/client.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let folderInput: HTMLInputElement;
	let zipInput: HTMLInputElement;
	let repo = $state('');
	let branch = $state('');
	let err = $state('');
	let busy = $state<{ message: string; fraction: number | null } | null>(null);
	let dragDepth = 0;

	const progress = (message: string, fraction: number | null) => (busy = { message, fraction });

	function signedIn(): boolean {
		if (data.user) return true;
		window.location.href = resolve('/auth/github');
		return false;
	}

	async function run(task: () => Promise<string>) {
		err = '';
		try {
			const id = await task();
			await goto(resolve('/workspace/[projectId]', { projectId: id }));
		} catch (e) {
			err = e instanceof ImportError ? e.message : 'Something went wrong — please try again.';
			if (!(e instanceof ImportError)) console.error(e);
		} finally {
			busy = null;
		}
	}

	async function uploadPicked(picked: { name: string; files: { path: string; file: Blob }[] }) {
		const archive = await zipFiles(picked.files, data.limits, progress);
		return uploadArchive(archive, picked.name, data.limits, progress);
	}

	function chooseFolder() {
		if (signedIn()) folderInput.click();
	}

	function chooseZip() {
		if (signedIn()) zipInput.click();
	}

	function trySample() {
		progress('Loading the sample project…', null);
		run(importSample);
	}

	function onFolderPicked() {
		const files = folderInput.files;
		if (files?.length) run(() => uploadPicked(filesFromInput(files)));
		folderInput.value = '';
	}

	function onZipPicked() {
		const file = zipInput.files?.[0];
		if (file) run(() => uploadArchive(file, file.name, data.limits, progress));
		zipInput.value = '';
	}

	function importGithub(e: SubmitEvent) {
		e.preventDefault();
		progress('Starting import…', null);
		run(() => importFromGithub(repo, branch));
	}

	// Drag-and-drop anywhere on the page (§4: corner brackets turn accent while dragging).
	function onDragEnter(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('Files')) return;
		dragDepth++;
		document.body.classList.add('dragging');
	}
	function onDragLeave() {
		if (--dragDepth <= 0) {
			dragDepth = 0;
			document.body.classList.remove('dragging');
		}
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragDepth = 0;
		document.body.classList.remove('dragging');
		if (!e.dataTransfer || !signedIn()) return;
		const dt = e.dataTransfer;
		progress('Reading folder…', null);
		run(async () => {
			const dropped = await filesFromDrop(dt);
			return 'zip' in dropped
				? uploadArchive(dropped.zip, dropped.zip.name, data.limits, progress)
				: uploadPicked(dropped);
		});
	}
</script>

<svelte:window
	ondragenter={onDragEnter}
	ondragleave={onDragLeave}
	ondragover={(e) => e.preventDefault()}
	ondrop={onDrop}
/>

<section class="landing">
	<div class="copy">
		<h1>Drop in a codebase and see how it fits together.</h1>
		<p class="lede">
			Repograph reads Java, JavaScript, TypeScript and Python projects and maps them from every
			angle. Your code is processed on our servers to build the visualizations and power chat, and
			never shared.
		</p>

		<div class="sheet">
			<p class="sheet-title">Drag a project folder onto this page, or pick one.</p>
			<div class="actions">
				<button class="btn primary" type="button" onclick={chooseFolder}>Choose folder</button>
				<button class="btn" type="button" onclick={trySample}>Try the sample project</button>
			</div>
			<p class="fine">
				Folders like node_modules, .git, build, dist and venv are skipped automatically.
				{#if !data.user}Sign in with GitHub to upload a folder or .zip.{/if}
			</p>

			<form class="gh" onsubmit={importGithub}>
				<label for="gh-repo">Or import from GitHub</label>
				<div class="gh-row">
					<input
						id="gh-repo"
						type="text"
						placeholder="github.com/owner/repo"
						autocomplete="off"
						spellcheck="false"
						bind:value={repo}
						required
					/>
					<input
						class="branch"
						type="text"
						placeholder="branch"
						aria-label="Branch (optional)"
						autocomplete="off"
						spellcheck="false"
						bind:value={branch}
					/>
					<button class="btn" type="submit">Import</button>
				</div>
				<p class="fine">
					Public repositories only. Leave the branch empty to use the repository's default branch.
					You can also drop a .zip of a project here, or
					<button class="link" type="button" onclick={chooseZip}>choose the .zip file</button>.
				</p>
			</form>

			<p class="err" role="alert" hidden={!err}>{err}</p>
		</div>

		<dl class="views">
			<dt>Tree</dt>
			<dd>
				The whole codebase as a node-and-line tree diagram. Click a folder to expand or collapse it.
			</dd>
			<dt>Size map</dt>
			<dd>Every file as a rectangle sized by line count. Click a folder to zoom in.</dd>
			<dt>Dependencies</dt>
			<dd>Which files or folders import which. Circular imports are drawn in magenta.</dd>
			<dt>Architecture</dt>
			<dd>
				A UML-style component diagram, arranged in layers, with a class diagram for any package.
			</dd>
			<dt>ER Diagram</dt>
			<dd>
				Database entities and relationships, detected from JPA, Django, SQLAlchemy or TypeORM code.
			</dd>
			<dt>Hotspots</dt>
			<dd>The biggest files, the most-imported files, and every import cycle.</dd>
		</dl>
		<p class="fine">
			A summary of the repo stays on the left and a chat panel stays on the right — whichever view
			you pick loads in the middle.
		</p>
	</div>

	<div class="art">
		<HeroGraph />
	</div>

	<input
		bind:this={folderInput}
		type="file"
		webkitdirectory
		multiple
		hidden
		onchange={onFolderPicked}
	/>
	<input bind:this={zipInput} type="file" accept=".zip" hidden onchange={onZipPicked} />
</section>

{#if busy}
	<LoadingOverlay message={busy.message} fraction={busy.fraction} />
{/if}

<style>
	.landing {
		flex: 1;
		display: grid;
		grid-template-columns: 1.05fr 0.95fr;
		gap: 48px;
		align-items: center;
		padding: 48px clamp(16px, 5vw, 72px);
		background-image:
			linear-gradient(var(--grid) 1px, transparent 1px),
			linear-gradient(90deg, var(--grid) 1px, transparent 1px);
		background-size: 32px 32px;
	}

	h1 {
		margin: 0 0 14px;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(2.2rem, 4.6vw, 3.7rem);
		line-height: 1.05;
		letter-spacing: -0.02em;
	}

	.lede {
		margin: 0 0 24px;
		max-width: 38em;
		font-size: 16px;
		color: var(--muted);
	}

	/* Drop zone: dashed card with 16px corner brackets drawn in --ink (--accent while dragging). */
	.sheet {
		--corner: var(--ink);
		position: relative;
		padding: 22px;
		margin-bottom: 26px;
		background: var(--panel);
		border: 1px dashed var(--line);
		background-image:
			linear-gradient(var(--corner), var(--corner)), linear-gradient(var(--corner), var(--corner)),
			linear-gradient(var(--corner), var(--corner)), linear-gradient(var(--corner), var(--corner)),
			linear-gradient(var(--corner), var(--corner)), linear-gradient(var(--corner), var(--corner)),
			linear-gradient(var(--corner), var(--corner)), linear-gradient(var(--corner), var(--corner));
		background-repeat: no-repeat;
		background-size:
			16px 2px,
			2px 16px,
			16px 2px,
			2px 16px,
			16px 2px,
			2px 16px,
			16px 2px,
			2px 16px;
		background-position:
			top left,
			top left,
			top right,
			top right,
			bottom left,
			bottom left,
			bottom right,
			bottom right;
	}

	:global(body.dragging) .sheet {
		--corner: var(--accent);
	}

	.sheet-title {
		margin: 0 0 14px;
		font-weight: 600;
		font-size: 15px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.btn {
		font: inherit;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 8px 16px;
		cursor: pointer;
	}

	.btn:hover {
		border-color: var(--ink);
	}

	.btn.primary {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--panel);
	}

	.fine {
		margin: 10px 0 0;
		font-size: 12.5px;
		color: var(--muted);
	}

	.link {
		font: inherit;
		color: var(--ink);
		background: none;
		border: 0;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
	}

	.gh {
		margin-top: 18px;
		padding-top: 16px;
		border-top: 1px dashed var(--line);
	}

	.gh label {
		display: block;
		margin-bottom: 8px;
		font-weight: 600;
	}

	.gh-row {
		display: flex;
		gap: 8px;
	}

	.gh-row input {
		flex: 1;
		min-width: 0;
		font: 13px/1.4 var(--font-mono);
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 10px;
	}

	.gh-row input.branch {
		flex: 0 0 110px;
	}

	.err {
		margin: 12px 0 0;
		color: var(--accent);
		font-weight: 600;
	}

	.err[hidden] {
		display: none;
	}

	.views {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 16px;
		margin: 0;
	}

	.views dt {
		font-family: var(--font-display);
		font-weight: 700;
	}

	.views dd {
		margin: 0;
		color: var(--muted);
	}

	.art {
		align-self: center;
	}

	@media (max-width: 900px) {
		.landing {
			grid-template-columns: 1fr;
			gap: 28px;
			padding: 28px 16px;
		}

		.art {
			order: -1;
		}

		.gh-row {
			flex-wrap: wrap;
		}

		.gh-row input.branch {
			flex: 1 1 110px;
		}
	}
</style>
