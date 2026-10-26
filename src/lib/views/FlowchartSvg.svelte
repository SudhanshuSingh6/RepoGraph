<script lang="ts">
	// The drawing of one control-flow chart scene, as SVG content: the dropdown and the
	// full-screen view (FlowchartFullscreen.svelte) both render it inside their own <svg>.
	import { EXECUTES_WORDS, OP_WORDS, opLabel, type CallQuery } from '#analysis/apis/queries.ts';
	import type { Workspace } from '#lib/workspace/state.svelte.ts';
	import {
		LINE,
		NOTE_LINE,
		type BoxShape,
		type CallChip,
		type Scene,
		type Shape
	} from './layout/flowchartLayout.ts';

	// `marker`: the arrowhead's id, unique per drawing on the page. `matches` / `current`:
	// shape ids found by Find in chart (full screen), outlined.
	let {
		ws,
		scene,
		marker,
		matches = new Set<string>(),
		current = null
	}: {
		ws: Workspace;
		scene: Scene;
		marker: string;
		matches?: Set<string>;
		current?: string | null;
	} = $props();

	const path = (file: number) => ws.graph.files[file]?.path ?? '';
	const fileOf = (p: string) => ws.graph.files.findIndex((f) => f.path === p);

	function queryTip(event: PointerEvent, q: CallQuery, file: number) {
		event.stopPropagation();
		const rows: [string, string][] = [['Op', OP_WORDS[q.op] ? `${q.op}: ${OP_WORDS[q.op]}` : q.op]];
		if (q.target) rows.push(['Target', q.entity ? `${q.target} (${q.entity.path})` : q.target]);
		rows.push([
			'Runs',
			EXECUTES_WORDS[q.executes] + (q.executesNote ? ` (${q.executesNote})` : '')
		]);
		if (q.guarded) rows.push(['Only', 'on a path that may not run (a branch, loop, callback…)']);
		if (q.oneOf) rows.push(['Which', `one of ${q.oneOf} implementations the call may reach`]);
		if (q.viaRepository) rows.push(['From', `${q.viaRepository} (repository method)`]);
		if (q.predicate === 'unknown')
			rows.push(['Condition', 'not parsed: the method name uses a keyword outside the grammar']);
		if (q.truncated)
			rows.push(['Shortened', `showing ${q.text.length - 1} of ${q.textLength} chars`]);
		rows.push(['Source', `${path(file)}:${q.line}`]);
		ws.showTip(event, q.text, rows);
	}

	function selectEntity(q: CallQuery) {
		const i = q.entity ? fileOf(q.entity.path) : -1;
		if (i >= 0) ws.selection = { file: i };
	}
	const MODE_MARK = {
		awaited: '⏳',
		deferred: '⇢',
		callback: '↪',
		unknown: '?',
		sync: ''
	} as const;

	function tip(event: PointerEvent, s: Shape) {
		if (s.type === 'dot') return;
		if (s.type === 'box' || s.type === 'diamond') {
			const rows: [string, string][] = [['Source', `${path(s.file)}:${s.line ?? '?'}`]];
			if (s.type === 'box' && s.mayThrow)
				rows.push([
					'⚡',
					s.inTry
						? 'may throw: any call can fail at runtime; goes to this try’s catches'
						: 'may throw: any call can fail at runtime; not caught here, so it goes to the caller'
				]);
			if (s.type === 'box' && s.overrides)
				rows.push(['finally', 'this exit replaces the pending return / exception']);
			if (s.unreachable) rows.push(['Unreachable', 'no path from the start reaches this']);
			if (s.fullLength)
				rows.push([
					'Shortened',
					`the statement is ${s.fullLength} characters; the first 400 are shown`
				]);
			ws.showTip(event, s.type === 'box' ? s.full : s.text, rows);
		} else if (s.type === 'frame') {
			ws.showTip(event, s.title, [
				['Source', `${path(s.file)}:${s.line}`],
				...(s.note ? ([['Runs', s.note]] as [string, string][]) : [])
			]);
		} else if (s.type === 'pill' && s.note) {
			ws.showTip(event, s.text, [['Goes', s.note]]);
		}
	}

	function chipTip(event: PointerEvent, c: CallChip) {
		event.stopPropagation();
		const rows: [string, string][] = [];
		if (c.targetLabel) rows.push(['Calls', c.targetLabel]);
		if (c.note) rows.push(['Runs', c.note]);
		if (c.when) rows.push(['Only', c.when]);
		if (c.why) rows.push(['Not opened', c.why]);
		ws.showTip(event, `${c.label}()`, rows);
	}

	function toggle(c: CallChip) {
		ws.chartOpen.set(c.key, !c.open);
	}

	function nextImpl(c: CallChip) {
		ws.chartChoice.set(c.key, (c.targetIndex + 1) % c.targets.length);
	}

	const boxes = $derived(scene.shapes.filter((s): s is BoxShape => s.type === 'box'));
</script>

<g class="fc">
	<defs>
		<marker
			id={marker}
			viewBox="0 0 8 8"
			refX="7"
			refY="4"
			markerWidth="7"
			markerHeight="7"
			orient="auto"
		>
			<path d="M0,0 L8,4 L0,8 z" class="head" />
		</marker>
	</defs>

	{#each scene.shapes as s (s.id)}
		{#if s.type === 'frame'}
			<g
				class="frame {s.mode}"
				class:lane={s.lane}
				class:hit={matches.has(s.id)}
				class:cur={current === s.id}
				onpointermove={(e) => tip(e, s)}
				onpointerleave={() => ws.hideTip()}
				role="presentation"
			>
				<rect x={s.x} y={s.y} width={s.w} height={s.h} rx="10" />
				{#each s.titleLines as t, k (k)}
					<text class="ftitle" x={s.x + 12} y={s.y + 18 + k * LINE}>
						{k === 0 && s.mode !== 'root' ? `${MODE_MARK[s.mode]} ` : ''}{t}
					</text>
				{/each}
			</g>
		{:else if s.type === 'region'}
			<g class="region">
				<rect x={s.x} y={s.y} width={s.w} height={s.h} rx="6" />
				<text x={s.x + 6} y={s.y + 12}>{s.title}</text>
			</g>
		{/if}
	{/each}

	{#each scene.links as l, i (i)}
		<path
			class="link {l.kind}"
			d={l.d}
			marker-end={l.kind === 'connector' ? '' : `url(#${marker})`}
		/>
		{#if l.label}<text class="elabel {l.kind}" x={l.lx} y={l.ly}>{l.label}</text>{/if}
	{/each}

	{#each scene.shapes as s (s.id)}
		{#if s.type === 'diamond'}
			<g
				class="diamond"
				class:dead={s.unreachable}
				class:hit={matches.has(s.id)}
				class:cur={current === s.id}
				onpointermove={(e) => tip(e, s)}
				onpointerleave={() => ws.hideTip()}
				role="presentation"
			>
				<polygon
					points="{s.x + s.w / 2},{s.y} {s.x + s.w},{s.y + s.h / 2} {s.x + s.w / 2},{s.y +
						s.h} {s.x},{s.y + s.h / 2}"
				/>
				{#each s.lines as t, k (k)}
					<text
						x={s.x + s.w / 2}
						y={s.y + s.h / 2 + 4 + (k - (s.lines.length - 1) / 2) * LINE}
						text-anchor="middle">{t}</text
					>
				{/each}
			</g>
		{:else if s.type === 'dot'}
			<circle class="dot" cx={s.x} cy={s.y} r="3" />
		{:else if s.type === 'pill'}
			<g
				class="pill {s.kind}"
				class:hit={matches.has(s.id)}
				class:cur={current === s.id}
				onpointermove={(e) => tip(e, s)}
				onpointerleave={() => ws.hideTip()}
				role="presentation"
			>
				<rect x={s.x} y={s.y} width={s.w} height={s.h} rx="12" />
				<text x={s.x + 12} y={s.y + 16}>{s.text}</text>
				{#each s.noteLines as t, k (k)}
					<text class="pnote" x={s.x} y={s.y + s.h + 13 + k * 13}>{t}</text>
				{/each}
			</g>
		{/if}
	{/each}

	{#each boxes as s (s.id)}
		<g
			class="box {s.kind}"
			class:dead={s.unreachable}
			class:override={s.overrides}
			class:hit={matches.has(s.id)}
			class:cur={current === s.id}
			onpointermove={(e) => tip(e, s)}
			onpointerleave={() => ws.hideTip()}
			role="presentation"
		>
			<rect
				x={s.x}
				y={s.y}
				width={s.w}
				height={s.h}
				rx={s.kind === 'return' || s.kind === 'throw' || s.kind === 'jump' ? 12 : 5}
			/>
			{#each s.lines as text, k (k)}
				<text class="stext" x={s.x + 10} y={s.y + 8 + LINE * (k + 1) - 5}>{text}</text>
			{/each}
			{#if s.more}
				<text
					class="more"
					x={s.x + 10}
					y={s.y + 8 + LINE * (s.lines.length + 1) - 5}
					role="button"
					tabindex="0"
					onclick={() => s.groupKey && ws.chartGroups.add(s.groupKey)}
					onkeydown={(e) => e.key === 'Enter' && s.groupKey && ws.chartGroups.add(s.groupKey)}
					>+ {s.more} more statements</text
				>
			{/if}
			{#if s.mayThrow}<text class="bolt" x={s.x + s.w - 14} y={s.y + 16}>⚡</text>{/if}
			{#each s.calls as c (c.key)}
				{@const cy = s.y + c.dy + 13}
				<g class="chip {c.mode} {c.kind}" onpointermove={(e) => chipTip(e, c)} role="presentation">
					{#if c.expandable}
						<text
							class="toggle"
							x={s.x + 10}
							y={cy}
							role="button"
							tabindex="0"
							aria-label="{c.open ? 'Close' : 'Open'} {c.label}()"
							onclick={(e) => {
								e.stopPropagation();
								toggle(c);
							}}
							onkeydown={(e) => e.key === 'Enter' && toggle(c)}>{c.open ? '▾' : '▸'}</text
						>
					{:else}
						<text class="toggle off" x={s.x + 10} y={cy}>·</text>
					{/if}
					{#each c.labelLines as t, k (k)}
						<text
							class="clabel"
							x={s.x + 24}
							y={cy + k * LINE}
							role="button"
							tabindex="0"
							onclick={() => c.targetFile !== null && (ws.selection = { file: c.targetFile })}
							onkeydown={(e) =>
								e.key === 'Enter' &&
								c.targetFile !== null &&
								(ws.selection = { file: c.targetFile })}
							>{k === 0 && MODE_MARK[c.mode] ? `${MODE_MARK[c.mode]} ` : ''}{t}</text
						>
					{/each}
					{#each c.noteLines as t, k (k)}
						<text class="cnote" x={s.x + 24} y={cy + c.labelLines.length * LINE + k * NOTE_LINE - 3}
							>{t}</text
						>
					{/each}
					{#each c.queries as cq, k (k)}
						{@const qy = s.y + cq.dy + 13}
						<g
							class="dbq op-{cq.q.op.toLowerCase()}"
							class:maybe={cq.q.executes === 'unknown'}
							onpointermove={(e) => queryTip(e, cq.q, s.file)}
							role="presentation"
						>
							<rect class="badge" x={s.x + 24} y={qy - 11} width={cq.badgeW} height="15" rx="3" />
							<text class="btext" x={s.x + 24 + cq.badgeW / 2} y={qy} text-anchor="middle"
								>{opLabel(cq.q.op)}</text
							>
							{#each cq.lines as t, j (j)}
								{#if cq.q.entity}
									<text
										class="qtext linked"
										x={s.x + 30 + cq.badgeW}
										y={qy + j * LINE}
										role="button"
										tabindex="0"
										onclick={() => selectEntity(cq.q)}
										onkeydown={(e) => e.key === 'Enter' && selectEntity(cq.q)}>{t}</text
									>
								{:else}
									<text class="qtext" x={s.x + 30 + cq.badgeW} y={qy + j * LINE}>{t}</text>
								{/if}
							{/each}
							{#each cq.flagLines as t, j (j)}
								<text class="qflag" x={s.x + 24} y={qy + cq.lines.length * LINE + j * NOTE_LINE - 2}
									>{t}</text
								>
							{/each}
						</g>
					{/each}
					{#if c.targets.length > 1}
						<text
							class="impl"
							x={s.x + s.w - 70}
							y={cy}
							role="button"
							tabindex="0"
							onclick={() => nextImpl(c)}
							onkeydown={(e) => e.key === 'Enter' && nextImpl(c)}
							>impl {c.targetIndex + 1}/{c.targets.length} ⟳</text
						>
					{/if}
				</g>
			{/each}
		</g>
	{/each}
</g>

<style>
	.fc {
		font-family: var(--font-body);
		font-size: 12px;
	}

	.frame rect {
		fill: var(--panel);
		stroke: var(--line);
	}

	.frame.root rect {
		fill: none;
		stroke: none;
	}

	.frame.lane rect {
		stroke-dasharray: 6 4;
		fill: color-mix(in srgb, var(--panel) 70%, transparent);
	}

	.ftitle {
		font-family: var(--font-mono);
		font-size: 11.5px;
		font-weight: 700;
		fill: var(--muted);
	}

	.region rect {
		fill: none;
		stroke: var(--line);
		stroke-dasharray: 4 3;
	}

	.region text {
		font-size: 10px;
		fill: var(--muted);
	}

	.link {
		fill: none;
		stroke: var(--edge);
		stroke-width: 1.3;
	}

	.link.exception {
		stroke: var(--accent);
		stroke-dasharray: 5 3;
	}

	.link.finally {
		stroke-dasharray: 2 3;
	}

	.link.jump {
		stroke: var(--blast);
	}

	.link.deferred {
		stroke-dasharray: 6 4;
	}

	.link.return-to-caller {
		stroke: var(--muted);
		stroke-dasharray: 2 2;
	}

	.link.calls {
		stroke: var(--ink);
		stroke-opacity: 0.55;
	}

	.link.connector {
		stroke: var(--edge);
	}

	.head {
		fill: var(--edge);
	}

	.elabel {
		font-size: 10px;
		fill: var(--muted);
	}

	.elabel.exception {
		fill: var(--accent);
	}

	.box rect,
	.diamond polygon {
		fill: var(--panel);
		stroke: var(--line);
	}

	.box.eval rect {
		fill: var(--panel2);
	}

	.box.return rect,
	.box.jump rect {
		stroke: var(--blast);
	}

	.box.throw rect {
		stroke: var(--accent);
	}

	.box.catch rect,
	.box.dispatch rect {
		stroke: var(--accent);
		stroke-dasharray: 4 2;
	}

	.box.finally rect,
	.box.close rect {
		stroke-dasharray: 2 2;
	}

	.box.override rect {
		stroke-width: 2;
	}

	/* .fc first, to outrank the per-kind strokes (.box.return rect, .frame.root rect …) */
	.fc g.hit > rect,
	.fc g.hit > polygon {
		stroke: var(--accent);
		stroke-width: 2;
		stroke-dasharray: none;
	}

	.fc g.cur > rect,
	.fc g.cur > polygon {
		stroke-width: 3.5;
	}

	.dbq {
		--q: var(--muted);
	}

	.dbq.op-select {
		--q: var(--lang-ts);
	}

	.dbq.op-insert {
		--q: var(--lang-py);
	}

	.dbq.op-update {
		--q: var(--lang-java);
	}

	.dbq.op-delete {
		--q: var(--accent);
	}

	.dbq.op-upsert {
		--q: var(--blast);
	}

	.dbq.op-save {
		--q: var(--lang-js);
	}

	.dbq .badge {
		fill: color-mix(in srgb, var(--q) 16%, transparent);
		stroke: var(--q);
	}

	.dbq.op-save .badge,
	.dbq.op-unknown .badge {
		stroke-dasharray: 3 2;
	}

	.dbq.maybe .badge {
		fill: none;
	}

	.btext {
		fill: var(--q);
		font-size: 10px;
		font-weight: 700;
		font-family: var(--font-mono);
	}

	.qtext {
		fill: var(--ink);
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.qtext.linked {
		cursor: pointer;
		text-decoration: underline dotted;
	}

	.qflag {
		fill: var(--muted);
		font-size: 10.5px;
	}

	.dead {
		opacity: 0.4;
	}

	.stext {
		fill: var(--ink);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}

	.more,
	.toggle,
	.clabel,
	.impl {
		cursor: pointer;
	}

	.more {
		fill: var(--muted);
		font-size: 11px;
		text-decoration: underline dotted;
	}

	.bolt {
		font-size: 11px;
	}

	.toggle {
		fill: var(--ink);
		font-size: 12px;
	}

	.toggle.off {
		fill: var(--muted);
		cursor: default;
	}

	.clabel {
		fill: var(--ink);
		font-family: var(--font-mono);
		font-size: 11.5px;
		font-weight: 600;
	}

	.chip.untraced .clabel,
	.chip.none .clabel {
		fill: var(--muted);
		font-weight: 400;
	}

	.cnote,
	.impl,
	.pnote {
		fill: var(--muted);
		font-size: 10.5px;
	}

	.diamond text {
		fill: var(--ink);
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.dot {
		fill: var(--muted);
	}

	.pill rect {
		fill: var(--panel2);
		stroke: var(--line);
	}

	.pill.throws rect {
		stroke: var(--accent);
	}

	.pill text {
		font-size: 11px;
		fill: var(--muted);
	}
</style>
