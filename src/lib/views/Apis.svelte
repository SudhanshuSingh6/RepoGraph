<script lang="ts">
	// APIs view (an addition to repograph-spec.md): the HTTP endpoints this repo declares,
	// found by static analysis of route declarations, each opening onto a control-flow
	// chart of its handler.
	import { groupEndpoints, matchesEndpoint, type Endpoint } from '#analysis/apis/index.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import ApiFlowchart from './ApiFlowchart.svelte';

	let { ws }: { ws: Workspace } = $props();

	$effect(() => ws.loadApis());
	// Leaving the tab closes a full-screen chart.
	$effect(() => () => (ws.chartFullscreen = null));

	const FRAMEWORKS: Record<Endpoint['framework'], string> = {
		spring: 'Spring',
		nestjs: 'NestJS',
		express: 'Express',
		flask: 'Flask',
		fastapi: 'FastAPI',
		django: 'Django'
	};
	const PREFIX_UNKNOWN =
		"This route is declared on a router, blueprint or URLconf that the analysis couldn't follow to the app, so the path is relative to it and the full URL may have a prefix.";
	const REGEX = 'A Django regular-expression route, shown as written.';
	const PARTIAL =
		'Tracing its calls hit the 5-level or 40-function limit, so the step count is a lower bound.';

	const fmt = (n: number) => n.toLocaleString();
	const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
	const files = $derived(ws.graph.files);

	const visible = $derived(
		(ws.apis ?? []).filter((e) => ws.active[e.file] && matchesEndpoint(e, files, ws.search))
	);
	const groups = $derived(groupEndpoints(visible, ws.apisGroup, files));
	// Endpoint objects → their index in `ws.apis`, which the chart route is keyed by.
	const indexOf = $derived(new Map((ws.apis ?? []).map((e, i) => [e, i])));

	function toggle(n: number) {
		if (ws.apisOpen.has(n)) {
			ws.apisOpen.delete(n);
			if (ws.chartFullscreen === n) ws.chartFullscreen = null;
		} else {
			ws.apisOpen.add(n);
			ws.loadChart(n);
		}
	}

	$effect(() => {
		for (const n of ws.apisOpen) ws.loadChart(n); // rows opened by "Expand all"
	});
	const unknownPrefix = $derived(visible.filter((e) => e.prefix === 'unknown').length);
	const fileCount = $derived(new Set(visible.map((e) => e.file)).size);

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

<div class="apis">
	<section class="card" aria-labelledby="apis-endpoints">
		<header>
			<h2 id="apis-endpoints">
				Endpoints{#if ws.apis && ws.apisHasData}&nbsp;({fmt(visible.length)}){/if}
			</h2>
			{#if ws.apis && ws.apisHasData && visible.length > 0}
				<p class="sub">
					{plural(visible.length, 'endpoint', 'endpoints')} declared in {plural(
						fileCount,
						'file',
						'files'
					)}{#if unknownPrefix > 0}
						· {fmt(unknownPrefix)} with a prefix that couldn't be resolved{/if}.
				</p>
			{/if}
		</header>

		{#if ws.apisError}
			<p class="empty">{ws.apisError}</p>
		{:else if !ws.apis}
			<p class="empty">Reading endpoints…</p>
		{:else if !ws.apisHasData}
			<p class="empty">
				This project was imported before the APIs view existed. Import it again to see its
				endpoints.
			</p>
		{:else if ws.apis.length === 0}
			<p class="empty">
				No HTTP endpoints detected. Supported: Spring, Express, NestJS, Flask, FastAPI, Django.
			</p>
		{:else if visible.length === 0}
			<p class="empty">No endpoints match the current filters.</p>
		{:else}
			{#each groups as g (g.key)}
				<div class="group">
					<h3>
						<span class="glabel">{g.label}</span>
						<span class="count">{fmt(g.endpoints.length)}</span>
					</h3>
					<ul class="list">
						{#each g.endpoints as e (`${e.file}:${e.line}:${e.method}:${e.path}`)}
							{@const n = indexOf.get(e)!}
							{@const open = ws.apisOpen.has(n)}
							{@const chart = ws.apiCharts[n]}
							{@const rootChart =
								chart && chart !== 'loading' && 'root' in chart && chart.root
									? ws.fnCharts.get(chart.root)
									: undefined}
							<li class="row" class:sel={ws.isSelectedFile(e.file)} class:open>
								<button
									type="button"
									class="chev"
									aria-expanded={open}
									aria-label="{open ? 'Hide' : 'Show'} the flowchart of {e.method} {e.path}"
									onclick={() => toggle(n)}>{open ? '▾' : '▸'}</button
								>
								<span class="method {methodClass(e.method)}">{e.method}</span>
								<span class="route">
									<span class="path" title={e.path}>{e.path}</span>
									{#if e.prefix === 'unknown'}
										<span class="flag" title={PREFIX_UNKNOWN}>prefix unknown</span>
									{/if}
									{#if e.regex}
										<span class="flag" title={REGEX}>regex</span>
									{/if}
									{#if e.handler.fn !== null}
										<span class="steps">{plural(e.steps, 'step', 'steps')}</span>
									{/if}
									{#if e.queries}
										<span class="steps" title="Detected DB queries in this flow; not all may run"
											>{e.partial ? 'at least ' : ''}{plural(e.queries, 'query', 'queries')}</span
										>
									{/if}
									{#if e.partial}
										<span class="flag partial" title={PARTIAL}>partial</span>
									{/if}
								</span>
								<span class="where">
									{#if e.handler.file !== null}
										<button
											type="button"
											class="handler"
											title="Select {files[e.handler.file].path}"
											onclick={() => (ws.selection = { file: e.handler.file! })}
										>
											{e.handler.label}
										</button>
									{:else}
										<span class="handler unresolved" title="The handler's definition wasn't found">
											{e.handler.label}
										</span>
									{/if}
									<button
										type="button"
										class="file"
										title="Select the file that declares this route"
										onclick={() => (ws.selection = { file: e.file })}
									>
										{files[e.file].path}:{e.line}
									</button>
								</span>
								<span class="fw">{FRAMEWORKS[e.framework]}</span>
							</li>
							{#if open}
								<li class="drop">
									{#if chart === undefined || chart === 'loading'}
										<p class="empty">Reading the handler…</p>
									{:else if 'error' in chart}
										<p class="empty">{chart.error}</p>
									{:else if chart.root === null}
										<p class="empty">
											The handler's definition wasn't found in the repo, so there's no chart to
											show.
										</p>
									{:else if rootChart && rootChart !== 'loading' && !('error' in rootChart)}
										<ApiFlowchart {ws} {n} root={rootChart} />
									{:else}
										<p class="empty">Reading the handler…</p>
									{/if}
								</li>
							{/if}
						{/each}
					</ul>
				</div>
			{/each}
		{/if}
	</section>
</div>

<style>
	.apis {
		position: absolute;
		inset: 0;
		overflow: auto;
		padding: 16px;
	}

	.card {
		max-width: 1100px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 14px 14px 10px;
	}

	h2 {
		margin: 0;
		font-size: 15px;
	}

	.sub {
		margin: 2px 0 6px;
		font-size: 12.5px;
		color: var(--muted);
	}

	.empty {
		margin: 8px 0;
		font-size: 13px;
		color: var(--muted);
	}

	.group {
		margin-top: 10px;
	}

	h3 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0;
		padding: 6px 6px 4px;
		font-size: 12.5px;
		border-bottom: 1px solid var(--line);
	}

	.glabel {
		font-family: var(--font-mono);
	}

	.count {
		font-weight: 400;
		color: var(--muted);
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: grid;
		grid-template-columns: 18px 64px minmax(0, 1fr) minmax(0, auto) auto;
		align-items: center;
		gap: 10px;
		padding: 5px 6px;
		border-radius: 6px;
	}

	.row:hover {
		background: var(--panel2);
	}

	.row.sel {
		background: var(--panel2);
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.chev {
		width: 18px;
		height: 18px;
		padding: 0;
		font-size: 11px;
		line-height: 1;
		color: var(--muted);
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}

	.chev:hover,
	.chev:focus-visible {
		color: var(--ink);
		background: var(--panel);
	}

	.steps {
		flex: none;
		font-size: 11px;
		color: var(--muted);
	}

	.flag.partial {
		color: var(--blast);
		border-color: color-mix(in srgb, var(--blast) 55%, transparent);
	}

	.drop {
		list-style: none;
	}

	.method {
		--c: var(--muted);
		justify-self: start;
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

	.route {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.path {
		font-family: var(--font-mono);
		font-size: 12.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.flag {
		flex: none;
		font-size: 10.5px;
		color: var(--muted);
		border: 1px dashed var(--line);
		border-radius: 999px;
		padding: 0 6px;
		cursor: help;
	}

	.where {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		min-width: 0;
	}

	.handler,
	.file {
		max-width: 100%;
		font: inherit;
		text-align: right;
		background: none;
		border: none;
		padding: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.handler {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
	}

	.handler.unresolved {
		color: var(--muted);
		cursor: default;
	}

	.file {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted);
	}

	.handler:hover,
	.file:hover {
		text-decoration: underline;
	}

	.fw {
		font-size: 11px;
		color: var(--muted);
	}

	@media (max-width: 900px) {
		.row {
			grid-template-columns: 18px 60px minmax(0, 1fr);
		}

		.where {
			grid-column: 3;
			align-items: flex-start;
		}

		.handler,
		.file {
			text-align: left;
		}

		.fw {
			display: none;
		}
	}
</style>
