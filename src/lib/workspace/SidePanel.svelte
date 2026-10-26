<script lang="ts">
	// repograph-spec.md §16: the always-visible overview/details pane — the repo overview
	// with no selection, else the selected file, folder or entity.
	import type { Workspace } from './state.svelte.ts';
	import { LANG_NAMES } from './langs.ts';
	import {
		entityDetails,
		fileDetails,
		folderDetails,
		overview,
		type LangShare
	} from './sidePanel.ts';

	let { ws }: { ws: Workspace } = $props();

	const LIST_CAP = 50; // rows per imports / imported-by list
	const ORM_NAMES = {
		jpa: 'JPA/Hibernate',
		typeorm: 'TypeORM',
		django: 'Django',
		sqlalchemy: 'SQLAlchemy',
		sqlmodel: 'SQLModel'
	};

	const fmt = (n: number) => n.toLocaleString();
	const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
	const files = $derived(ws.graph.files);
	const base = (i: number) => files[i].path.slice(files[i].path.lastIndexOf('/') + 1);

	// The overview's "possibly unused" count needs the type data, whichever tab is open.
	$effect(() => ws.loadTypes());

	const sel = $derived(ws.selection);
	const ov = $derived(sel ? null : overview(files, ws.derived, ws.unused?.length ?? null));
	const file = $derived(
		sel && 'file' in sel ? fileDetails(sel.file, files, ws.derived, ws.full) : null
	);
	const folder = $derived(
		sel && 'folder' in sel ? folderDetails(sel.folder, files, ws.active) : null
	);
	const entity = $derived(
		sel && 'entity' in sel && ws.entities
			? entityDetails(sel.entity, ws.entities, ws.relations)
			: null
	);

	const selectFile = (i: number) => (ws.selection = { file: i });
	const clear = () => (ws.selection = null);
</script>

{#snippet languages(shares: LangShare[], total: number)}
	<div class="bar" role="img" aria-label="Lines of code by language">
		{#each shares as l (l.lang)}
			<span
				style:width="{(l.lines / Math.max(total, 1)) * 100}%"
				style:background="var(--lang-{l.lang})"
			></span>
		{/each}
	</div>
	<ul class="legend">
		{#each shares as l (l.lang)}
			<li class="lrow">
				<i style:background="var(--lang-{l.lang})"></i>
				<span>{LANG_NAMES[l.lang]}</span>
				<span class="num">{plural(l.files, 'file', 'files')}</span>
				<span class="num">{fmt(l.lines)} lines</span>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet fileList(list: number[], cap: number)}
	<ul class="files">
		{#each list.slice(0, cap) as i (i)}
			<li>
				<button type="button" class="frow" onclick={() => selectFile(i)} title={files[i].path}>
					<i style:background="var(--lang-{files[i].lang})"></i>
					<span class="fname">{base(i)}</span>
					<span class="fpath">{files[i].path.slice(0, -base(i).length - 1)}</span>
				</button>
			</li>
		{/each}
	</ul>
	{#if list.length > cap}
		<p class="more">and {fmt(list.length - cap)} more</p>
	{/if}
{/snippet}

{#snippet header(kind: string)}
	<div class="head">
		<span class="kind">{kind}</span>
		<button type="button" class="clear" onclick={clear}>Clear selection</button>
	</div>
{/snippet}

<aside class="side" aria-live="polite" aria-label="Details">
	{#if file}
		{@render header('File')}
		<h2 class="path">{file.file.path}</h2>
		<div class="tags">
			<span class="pill" style:--c="var(--lang-{file.file.lang})">
				{LANG_NAMES[file.file.lang]}
			</span>
			{#if file.inCycle}<span class="badge">In an import cycle</span>{/if}
			{#if file.file.isTest}<span class="tag">Test</span>{/if}
			{#if file.file.isEntry}<span class="tag">Entry point</span>{/if}
		</div>
		{#if file.hidden}
			<p class="note">Hidden by the current filters; counts are for the whole repo.</p>
		{/if}
		<dl class="kv three">
			<div>
				<dt>Lines</dt>
				<dd>{fmt(file.file.loc)}</dd>
			</div>
			<div>
				<dt>Imported by</dt>
				<dd>{fmt(file.fanIn)}</dd>
			</div>
			<div>
				<dt>Imports</dt>
				<dd>{fmt(file.fanOut)}</dd>
			</div>
		</dl>
		<h3>Imports</h3>
		{#if file.imports.length}
			{@render fileList(file.imports, LIST_CAP)}
		{:else}
			<p class="none">No files in this repo.</p>
		{/if}
		<h3>Imported by</h3>
		{#if file.importedBy.length}
			{@render fileList(file.importedBy, LIST_CAP)}
		{:else}
			<p class="none">No files in this repo.</p>
		{/if}
	{:else if folder}
		{@render header('Folder')}
		<h2 class="path">{folder.folder}/</h2>
		<dl class="kv">
			<div>
				<dt>Files</dt>
				<dd>{fmt(folder.files.length)}</dd>
			</div>
			<div>
				<dt>Lines</dt>
				<dd>{fmt(folder.lines)}</dd>
			</div>
		</dl>
		{#if folder.files.length}
			{@render languages(folder.languages, folder.lines)}
			<h3>Files</h3>
			{@render fileList(folder.files, Infinity)}
		{:else}
			<p class="none">No files here match the current filters.</p>
		{/if}
	{:else if entity}
		{@const e = entity.entity}
		{@render header('Entity')}
		<h2>{e.name}</h2>
		<p class="table">table <code>{e.table}</code> · {ORM_NAMES[e.orm]}</p>
		<p class="defined">
			Defined in
			<button type="button" class="link" onclick={() => selectFile(e.file)}>
				{files[e.file].path}:{e.line}
			</button>
		</p>
		<h3>Fields</h3>
		{#if e.fields.length}
			<ul class="fields">
				{#each e.fields as f, k (k)}
					<li class:pk={f.pk}>
						<span>{f.name}</span><span class="type">{f.type}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="none">No mapped fields declared on this class.</p>
		{/if}
		<h3>Relationships</h3>
		{#if entity.relations.length}
			<ul class="fields">
				{#each entity.relations as r, k (k)}
					<li>
						<span>{r.field}</span>
						<span class="card">{r.kind}</span>
						{#if r.to !== null}
							{@const to = r.to}
							<button type="button" class="link" onclick={() => (ws.selection = { entity: to })}>
								{r.target}
							</button>
						{:else}
							<span class="type" title="Not an entity of this ORM in the repo">{r.target}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="none">None.</p>
		{/if}
	{:else if sel && 'entity' in sel}
		{@render header('Entity')}
		<p class="none">Reading entities…</p>
	{:else if ov}
		<h2>{ws.name}</h2>
		<dl class="kv">
			<div>
				<dt>Files</dt>
				<dd>{fmt(ov.files)}</dd>
			</div>
			<div>
				<dt>Lines</dt>
				<dd>{fmt(ov.lines)}</dd>
			</div>
			<div>
				<dt>Imports</dt>
				<dd>{fmt(ov.imports)}</dd>
			</div>
			<div>
				<dt>Import cycles</dt>
				<dd class:warn={ov.cycles > 0}>{fmt(ov.cycles)}</dd>
			</div>
		</dl>
		{#if ov.files}
			{@render languages(ov.languages, ov.lines)}
			<nav class="ovnav" aria-label="Places to look">
				{#if ov.cycles}
					<button type="button" onclick={() => (ws.view = 'hotspots')}>
						<b>{fmt(ov.cycles)}</b>
						{ov.cycles === 1 ? 'import cycle' : 'import cycles'}
					</button>
				{/if}
				{#if ov.unused}
					<button type="button" onclick={() => (ws.view = 'hotspots')}>
						<b>{fmt(ov.unused)}</b>
						{ov.unused === 1 ? 'possibly unused file' : 'possibly unused files'}
					</button>
				{/if}
				{#if ov.mostImported !== null}
					{@const i = ov.mostImported}
					<button type="button" onclick={() => selectFile(i)}>
						<span class="lbl">Most imported</span>
						<b class="fname">{base(i)}</b>
					</button>
				{/if}
				{#if ov.largest !== null}
					{@const i = ov.largest}
					<button type="button" onclick={() => selectFile(i)}>
						<span class="lbl">Largest</span>
						<b class="fname">{base(i)}</b>
					</button>
				{/if}
			</nav>
		{:else}
			<p class="none">No files match the current filters.</p>
		{/if}
	{/if}
</aside>

<style>
	.side {
		min-height: 0;
		overflow: auto;
		padding: 18px;
		background: var(--panel);
		border-right: 1px solid var(--line);
	}

	h2 {
		margin: 0 0 12px;
		font-family: var(--font-display);
		font-size: 18px;
		overflow-wrap: anywhere;
	}

	h2.path {
		font-family: var(--font-mono);
		font-size: 14px;
		word-break: break-all;
	}

	h3 {
		margin: 18px 0 6px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.kind {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.clear,
	.link {
		padding: 0;
		font: inherit;
		color: var(--accent);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.clear {
		font-size: 12.5px;
	}

	.link {
		font-family: var(--font-mono);
		font-size: 12px;
		text-align: left;
		word-break: break-all;
	}

	.kv {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 10px 14px;
		margin: 0 0 16px;
	}

	.kv.three {
		grid-template-columns: repeat(3, 1fr);
	}

	.kv div {
		min-width: 0;
	}

	.kv dt {
		font-size: 12px;
		color: var(--muted);
	}

	.kv dd {
		margin: 0;
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}

	.kv dd.warn {
		color: var(--accent);
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
		margin: 0;
		padding: 0;
	}

	.legend {
		margin-top: 12px;
	}

	.lrow {
		display: grid;
		grid-template-columns: 12px 1fr auto auto;
		align-items: center;
		gap: 10px;
		padding: 4px 0;
	}

	.lrow i,
	.frow i {
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

	.ovnav {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
		margin-top: 18px;
	}

	.ovnav button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 0;
		padding: 10px 12px;
		font: inherit;
		font-size: 12.5px;
		text-align: left;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 10px;
		cursor: pointer;
	}

	.ovnav button:hover {
		border-color: var(--ink);
	}

	.ovnav b {
		font-family: var(--font-display);
		font-size: 20px;
		font-variant-numeric: tabular-nums;
	}

	.ovnav b.fname {
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: 12.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ovnav .lbl {
		color: var(--muted);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 14px;
	}

	.pill,
	.badge,
	.tag {
		padding: 2px 10px;
		font-size: 12px;
		font-weight: 600;
		border-radius: 999px;
	}

	.pill {
		color: var(--ink);
		background: color-mix(in srgb, var(--c) 28%, transparent);
		border: 1px solid var(--c);
	}

	.badge {
		color: var(--accent);
		border: 1px solid var(--accent);
	}

	.tag {
		color: var(--muted);
		border: 1px solid var(--line);
	}

	.note {
		margin: 0 0 12px;
		font-size: 12.5px;
		color: var(--muted);
	}

	.frow {
		display: grid;
		grid-template-columns: 10px auto minmax(0, 1fr);
		align-items: baseline;
		gap: 8px;
		width: 100%;
		padding: 4px 6px;
		font: inherit;
		text-align: left;
		color: var(--ink);
		background: none;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}

	.frow i {
		align-self: center;
	}

	.frow:hover,
	.frow:focus-visible {
		background: var(--panel2);
	}

	.fname {
		font-weight: 600;
	}

	.fpath {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.more,
	.none {
		margin: 4px 0;
		font-size: 12.5px;
		color: var(--muted);
	}

	.table,
	.defined {
		margin: 0 0 6px;
		font-size: 13px;
		color: var(--muted);
	}

	.table code {
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.fields li {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 3px 0;
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.fields li.pk {
		font-weight: 700;
	}

	.fields .type {
		color: var(--muted);
	}

	.fields .card {
		font-weight: 700;
		color: var(--accent);
	}
</style>
