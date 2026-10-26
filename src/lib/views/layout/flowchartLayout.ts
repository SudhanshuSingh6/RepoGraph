import {
	buildCfg,
	ownNodes,
	type Cfg,
	type CfgEdge,
	type CfgNode,
	type EdgeKind
} from '#analysis/apis/cfg.ts';
import {
	callMode,
	expandability,
	refKey,
	whenWords,
	UNTRACED_WORDS,
	type CallMode,
	type Blocked,
	type ChartCall,
	type FnChart
} from '#analysis/apis/flowchart.ts';
import { opLabel, type CallQuery } from '#analysis/apis/queries.ts';
import type { Step } from '#analysis/apis/steps.ts';
import type { FnRef } from '#analysis/apis/trace.ts';

// Lays out a function's control-flow chart top to bottom, following its statement tree
// (structured code composes: each construct is a block with an entry above and an exit
// below), then draws every CFG edge between the placed nodes. Calls opened inline become
// frames holding the callee's own chart. Pure: charts and open/closed state in, shapes
// and paths out.

export const CHAR = 7; // glyph width of the chart's 11.5px monospace text
export const LINE = 18;
export const BOX_MIN = 150;
export const BOX_MAX = 520;
export const GAP_Y = 26;
export const GAP_X = 40;
export const INDENT = 30; // room left of a loop body for its repeat edge
export const DIAMOND_H = 52; // the smallest decision; longer conditions get taller ones
export const DIAMOND_LINES = 4;
export const NOTE_LINE = 15; // a call's note, under its name
export const FRAME_PAD = 14;
export const GROUP_LINES = 4; // call-free statements listed in a group box before "+ n more"

export type CallChip = {
	index: number;
	label: string;
	mode: CallMode;
	note: string;
	when: string | null;
	kind: ChartCall['kind'];
	reason: string | null;
	targetLabel: string | null;
	expandable: boolean;
	why: string | null; // why it can't be opened
	blocked: Blocked | null;
	open: boolean;
	key: string; // open/closed state key
	targetIndex: number; // which implementation (fanout)
	targets: { label: string; index: number }[];
	targetFile: number | null;
	dy: number; // the call's first line, from the box's top
	labelLines: string[];
	noteLines: string[];
	queries: ChipQuery[]; // detected DB queries at this call, drawn under its note
};

/** A query row under a call: an op badge, then `target · condition` (wrapped), then
 * its labels (may not execute, conditional, …). `dy`: from the box's top. */
export type ChipQuery = {
	q: CallQuery;
	dy: number;
	badgeW: number;
	lines: string[];
	flagLines: string[];
};

export const QUERY_BADGE_CHAR = 6.6; // the badge's 10px bold text
export const QUERY_LINES = 3; // a query row's text in the chart; the rest is on hover

/** The labels a query row carries, in words. */
export function queryFlags(q: CallQuery): string[] {
	const out: string[] = [];
	if (q.executes === 'unknown') out.push('may not execute');
	if (q.executesNote) out.push(q.executesNote);
	if (q.guarded) out.push('conditional');
	if (q.oneOf) out.push(`one of ${q.oneOf} implementations`);
	if (q.predicate === 'unknown') out.push('condition not parsed');
	if (q.truncated) out.push(`shortened: ${q.textLength} chars in full`);
	return out;
}

/** What a query row says after its badge. */
export const queryLine = (q: CallQuery) => `${q.target ?? '?'} · ${q.detail ?? q.text}`;

export type Rect = { x: number; y: number; w: number; h: number };

export type BoxShape = Rect & {
	type: 'box';
	id: string;
	kind: CfgNode['kind'] | 'group';
	lines: string[];
	full: string; // the whole text, for hover
	fullLength: number | null; // the statement's real length when the worker shortened it
	more: number; // grouped statements not listed
	groupKey: string | null;
	line: number | null;
	file: number;
	unreachable: boolean;
	overrides: boolean;
	mayThrow: boolean;
	inTry: boolean; // its exceptions reach a catch in this function
	calls: CallChip[];
};
export type DiamondShape = Rect & {
	type: 'diamond';
	id: string;
	text: string;
	lines: string[];
	line: number | null;
	file: number;
	unreachable: boolean;
	fullLength: number | null;
};
export type DotShape = { type: 'dot'; id: string; x: number; y: number };
export type FrameShape = Rect & {
	type: 'frame';
	id: string;
	title: string;
	file: number;
	line: number;
	mode: CallMode | 'root';
	note: string;
	lane: boolean; // a deferred or callback frame: the caller doesn't wait for it
	titleLines: string[];
};
export type RegionShape = Rect & { type: 'region'; id: string; title: string };
export type PillShape = Rect & {
	type: 'pill';
	id: string;
	kind: 'entry' | 'exit' | 'throws';
	text: string;
	note: string | null;
	noteLines: string[];
};
export type Shape = BoxShape | DiamondShape | DotShape | FrameShape | RegionShape | PillShape;

export type Link = {
	d: string;
	kind: EdgeKind | 'return-to-caller' | 'deferred' | 'calls' | 'connector';
	label: string;
	lx: number;
	ly: number;
};

/** `missing`: charts of opened calls that aren't loaded yet (the view fetches them). */
export type Scene = {
	width: number;
	height: number;
	shapes: Shape[];
	links: Link[];
	missing: FnRef[];
};

export type LayoutInput = {
	chartOf: (ref: FnRef) => FnChart | 'loading' | { error: string } | undefined;
	/** Open/closed for an inline call frame, by its key; `fallback` is the default. */
	isOpen: (key: string, fallback: boolean) => boolean;
	/** Which implementation of a fanout call is shown, by the call's key. */
	chosen: (key: string) => number;
	groupOpen: (key: string) => boolean;
};

/** The width a line of text wants, within the box limits. */
const boxWidth = (text: string) =>
	Math.round(Math.min(BOX_MAX, Math.max(BOX_MIN, text.length * CHAR + 24)));

/**
 * Breaks text into lines that fit `width` px: on spaces, and inside a token only when
 * the token alone is too long (a long identifier or string). Past `maxLines`, the last
 * line ends in `…` (the full text is on hover).
 */
export function wrap(text: string, width: number, maxLines = Infinity): string[] {
	const per = Math.max(8, Math.floor((width - 20) / CHAR));
	const lines: string[] = [];
	let cur = '';
	for (const word of text.split(' ')) {
		let w = word;
		while (w.length > per) {
			if (cur) {
				lines.push(cur);
				cur = '';
			}
			lines.push(w.slice(0, per));
			w = w.slice(per);
		}
		if (!cur) cur = w;
		else if (cur.length + 1 + w.length <= per) cur += ` ${w}`;
		else {
			lines.push(cur);
			cur = w;
		}
	}
	if (cur || !lines.length) lines.push(cur);
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		const last = kept[maxLines - 1];
		kept[maxLines - 1] = `${last.slice(0, Math.max(0, per - 1))}…`;
		return kept;
	}
	return lines;
}

type Ctx = {
	input: LayoutInput;
	shapes: Shape[];
	links: Link[];
	channel: number; // stacking offset for right-channel routes
	missing: FnRef[];
};

type Placed = {
	box: Map<number, Rect>; // where edges enter a node
	block: Map<number, Rect>; // where edges leave it (a statement and its open frames)
	group: Map<number, string>; // grouped statements → their shared box id
	loops: Map<number, Rect>; // decision id → its loop block (for repeat edges)
	regions: Map<number, Rect>; // dispatch id → the try body region (exception rail)
};

/** Lays out the handler's chart (its frame at the top level). */
export function layoutChart(root: FnChart, input: LayoutInput, rootKey = 'root'): Scene {
	const ctx: Ctx = { input, shapes: [], links: [], channel: 0, missing: [] };
	const r = layoutFunction(root, 0, 0, rootKey, [], 0, ctx, 'root', '', null);
	let width = r.w;
	let height = r.h;
	for (const s of ctx.shapes) {
		if (s.type === 'dot') continue;
		width = Math.max(width, s.x + s.w);
		height = Math.max(height, s.y + s.h);
	}
	return {
		width: width + 140,
		height: height + 10,
		shapes: ctx.shapes,
		links: ctx.links,
		missing: ctx.missing
	};
}

/** One function's frame at (x, y): entry, body, exit and its edges. */
function layoutFunction(
	chart: FnChart,
	x: number,
	y: number,
	frameKey: string,
	ancestors: string[],
	depth: number,
	ctx: Ctx,
	mode: CallMode | 'root',
	note: string,
	throwsNote: string | null
): { w: number; h: number } {
	const cfg = buildCfg(chart.body, chart.lang);
	const placed: Placed = {
		box: new Map(),
		block: new Map(),
		group: new Map(),
		loops: new Map(),
		regions: new Map()
	};
	const frameIdx = ctx.shapes.length;
	const titleLines = wrap(`${chart.label}${note ? ` · ${note}` : ''}`, BOX_MAX);
	ctx.shapes.push({
		type: 'frame',
		id: `frame:${frameKey}`,
		title: chart.label,
		file: chart.file,
		line: chart.line,
		mode,
		note,
		lane: mode === 'deferred' || mode === 'callback',
		titleLines,
		x,
		y,
		w: 0,
		h: 0
	});
	const inner = { x: x + FRAME_PAD, y: y + FRAME_PAD + LINE * titleLines.length + 4 };
	const entry: PillShape = {
		type: 'pill',
		id: `${frameKey}:entry`,
		kind: 'entry',
		text: 'start',
		note: null,
		noteLines: [],
		x: inner.x,
		y: inner.y,
		w: 70,
		h: 24
	};
	ctx.shapes.push(entry);
	placed.box.set(cfg.entry, entry);
	placed.block.set(cfg.entry, entry);
	const sub = {
		chart,
		cfg,
		placed,
		frameKey,
		ancestors: [...ancestors, refKey(chart.ref)],
		depth,
		ctx
	};
	const body = layoutSeq(chart.body, inner.x, inner.y + 24 + GAP_Y, sub);
	const exitY = inner.y + 24 + GAP_Y + body.h + (body.h ? GAP_Y : 0);
	const exitText =
		mode === 'deferred'
			? 'completes later'
			: mode === 'callback'
				? 'end → back to whoever called it'
				: 'end → back to caller';
	const exit: PillShape = {
		type: 'pill',
		id: `${frameKey}:exit`,
		kind: 'exit',
		text: exitText,
		note: null,
		noteLines: [],
		x: inner.x,
		y: exitY,
		w: exitText.length * CHAR + 28,
		h: 24
	};
	ctx.shapes.push(exit);
	placed.box.set(cfg.exit, exit);
	placed.block.set(cfg.exit, exit);
	let w = Math.max(body.w, exit.w, ...titleLines.map((t) => t.length * CHAR + 24));
	if (cfg.edges.some((e) => e.to === cfg.throws)) {
		const tn =
			mode === 'deferred'
				? 'rejects / throws later, not caught here'
				: mode === 'callback'
					? 'to whoever called the callback'
					: (throwsNote ?? 'throws to caller');
		const t: PillShape = {
			type: 'pill',
			id: `${frameKey}:throws`,
			kind: 'throws',
			text: 'throws to caller',
			note: tn,
			noteLines: tn === 'throws to caller' ? [] : wrap(tn, 300),
			x: inner.x + exit.w + GAP_X,
			y: exitY,
			w: 130,
			h: 24
		};
		ctx.shapes.push(t);
		placed.box.set(cfg.throws, t);
		placed.block.set(cfg.throws, t);
		w = Math.max(w, exit.w + GAP_X + t.w);
	}
	const throwsPill = ctx.shapes.find(
		(sh): sh is PillShape => sh.type === 'pill' && sh.id === `${frameKey}:throws`
	);
	const h = exitY + 24 + (throwsPill?.noteLines.length ?? 0) * 13 - y + FRAME_PAD;
	const frameW = w + FRAME_PAD * 2;
	drawEdges(cfg, placed, ctx, x + frameW);
	const frame = ctx.shapes[frameIdx] as FrameShape;
	frame.w = frameW + 60; // room for the channels its jumps and exceptions run in
	frame.h = h;
	return { w: frame.w, h };
}

type Sub = {
	chart: FnChart;
	cfg: Cfg;
	placed: Placed;
	frameKey: string;
	ancestors: string[];
	depth: number;
	ctx: Ctx;
};

const childrenOf = (s: Step): Step[] => {
	switch (s.kind) {
		case 'if':
			return [...s.then, ...(s.else ?? [])];
		case 'loop':
			return [...(s.init ?? []), ...s.body, ...(s.orelse ?? [])];
		case 'switch':
		case 'match':
			return s.cases.flatMap((c) => c.body);
		case 'try':
			return [
				...s.body,
				...(s.orelse ?? []),
				...s.catches.flatMap((c) => c.body),
				...(s.finally ?? [])
			];
		case 'with':
		case 'block':
			return s.body;
		default:
			return [];
	}
};

/** A sequence of steps stacked from (x, y); runs of call-free statements share a box. */
function layoutSeq(steps: Step[], x: number, y: number, sub: Sub): { w: number; h: number } {
	let cy = y;
	let w = 0;
	for (let k = 0; k < steps.length;) {
		const s = steps[k];
		let run = 0;
		while (
			k + run < steps.length &&
			steps[k + run].kind === 'stmt' &&
			(steps[k + run] as Extract<Step, { kind: 'stmt' }>).calls.length === 0
		)
			run++;
		const r =
			run >= 2 ? layoutGroup(steps.slice(k, k + run), x, cy, sub) : layoutStep(s, x, cy, sub);
		k += run >= 2 ? run : 1;
		w = Math.max(w, r.w);
		cy += r.h + (k < steps.length ? GAP_Y : 0);
	}
	return { w, h: cy - y };
}

function layoutGroup(steps: Step[], x: number, y: number, sub: Sub): { w: number; h: number } {
	const ids = steps.flatMap((s) => ownNodes(sub.cfg, s, []).map((n) => n.id));
	const key = `${sub.frameKey}:group:${ids[0]}`;
	const open = sub.ctx.input.groupOpen(key);
	const texts = steps.map((s) => (s as Extract<Step, { kind: 'stmt' }>).text);
	const shownTexts = open ? texts : texts.slice(0, GROUP_LINES);
	const more = texts.length - shownTexts.length;
	const w = Math.max(...shownTexts.map(boxWidth));
	const shown = shownTexts.flatMap((t) => wrap(t, w));
	const h = 10 + LINE * (shown.length + (more ? 1 : 0)) + 6;
	const first = sub.cfg.nodes[ids[0]];
	const box: BoxShape = {
		type: 'box',
		id: key,
		kind: 'group',
		lines: shown,
		full: texts.join('\n'),
		fullLength: null,
		more,
		groupKey: key,
		line: first?.line ?? null,
		file: sub.chart.file,
		unreachable: ids.every((id) => sub.cfg.nodes[id].unreachable),
		overrides: false,
		mayThrow: false,
		inTry: false,
		calls: [],
		x,
		y,
		w,
		h
	};
	sub.ctx.shapes.push(box);
	for (const id of ids) {
		sub.placed.box.set(id, box);
		sub.placed.block.set(id, box);
		sub.placed.group.set(id, key);
	}
	return { w, h };
}

/** A statement-like node: a box with its text (wrapped, never cut) and its calls, each
 * with its note under it. Calls opened inline get frames in a column to the right, in
 * call order; the caller's next step starts below them, because it waits for them
 * (deferred and callback frames take room there too, but nothing waits for them). */
function placeNodeBox(
	n: CfgNode,
	x: number,
	y: number,
	sub: Sub,
	extraText: string | null = null
): { w: number; h: number } {
	const chips = n.calls.map((i) => chip(i, sub));
	const text = extraText ?? n.text;
	const want = (c: CallChip) =>
		Math.max(
			`${c.label}()`.length * CHAR + 50,
			...c.queries.map(
				(x) => queryLine(x.q).length * CHAR + opLabel(x.q.op).length * QUERY_BADGE_CHAR + 80
			)
		);
	const w = Math.round(
		Math.min(BOX_MAX, Math.max(boxWidth(text), ...chips.map((c) => Math.min(BOX_MAX, want(c)))))
	);
	const lines = wrap(text, w - 16); // room for the ⚡ marker
	let dy = 8 + LINE * lines.length;
	for (const c of chips) {
		c.labelLines = wrap(`${c.label}()`, w - 30);
		const note = [c.when, c.expandable || c.kind !== 'target' ? c.note : (c.why ?? c.note)]
			.filter(Boolean)
			.join(' · ');
		c.noteLines = note ? wrap(note, w - 30) : [];
		c.dy = dy + 4;
		dy += LINE * c.labelLines.length + NOTE_LINE * c.noteLines.length + 4;
		for (const cq of c.queries) {
			cq.badgeW = Math.round(opLabel(cq.q.op).length * QUERY_BADGE_CHAR + 10);
			cq.lines = wrap(queryLine(cq.q), w - 36 - cq.badgeW, QUERY_LINES);
			const flags = queryFlags(cq.q).join(' · ');
			cq.flagLines = flags ? wrap(flags, w - 30) : [];
			cq.dy = dy + 2;
			dy += LINE * cq.lines.length + NOTE_LINE * cq.flagLines.length + 4;
		}
	}
	const h = dy + 8;
	const box: BoxShape = {
		type: 'box',
		id: `${sub.frameKey}:n${n.id}`,
		kind: n.kind,
		lines,
		full: text,
		fullLength: n.fullLength ?? null,
		more: 0,
		groupKey: null,
		line: n.line,
		file: sub.chart.file,
		unreachable: n.unreachable,
		overrides: !!n.overrides,
		mayThrow: sub.cfg.edges.some((e) => e.from === n.id && e.kind === 'exception'),
		inTry: sub.cfg.edges.some(
			(e) => e.from === n.id && e.kind === 'exception' && e.to !== sub.cfg.throws
		),
		calls: chips,
		x,
		y,
		w,
		h
	};
	sub.ctx.shapes.push(box);
	sub.placed.box.set(n.id, box);

	const fx = x + w + GAP_X; // the frames' column
	let fy = y; // where the next frame goes
	let waitsUntil = y + h; // the caller continues below its inline frames
	let frameW = 0;
	const cx = x + Math.min(24, w / 2); // the caller's connector, where its next edge starts
	for (const c of chips) {
		if (!c.open) continue;
		const target = sub.chart.calls[c.index].targets[c.targetIndex];
		if (!target) continue;
		const callee = sub.ctx.input.chartOf(target.ref);
		const fkey = `${c.key}`;
		const chipY = y + c.dy + 4;
		if (callee && callee !== 'loading' && !('error' in callee)) {
			const waits = c.mode !== 'deferred' && c.mode !== 'callback';
			const r = layoutFunction(
				callee,
				fx,
				fy,
				fkey,
				sub.ancestors,
				sub.depth + 1,
				sub.ctx,
				c.mode,
				c.note,
				waits ? exceptionTarget(sub.cfg, n.id) : null
			);
			sub.ctx.links.push({
				d: `M${x + w},${chipY} L${fx - 10},${chipY} L${fx - 10},${fy + 14} L${fx},${fy + 14}`,
				kind: waits ? 'calls' : 'deferred',
				label:
					c.mode === 'awaited'
						? 'awaits'
						: c.mode === 'deferred'
							? 'starts (deferred)'
							: c.mode === 'callback'
								? 'passes a callback'
								: 'calls',
				lx: x + w + 4,
				ly: chipY - 4
			});
			if (waits) {
				const ry = fy + r.h - 14;
				sub.ctx.links.push({
					d: `M${fx},${ry} L${cx},${ry}`,
					kind: 'return-to-caller',
					label: c.mode === 'awaited' ? '↩ resumes after await' : '↩ returns',
					lx: cx + 6,
					ly: ry - 4
				});
				waitsUntil = Math.max(waitsUntil, ry + 10);
			}
			fy += r.h + GAP_Y;
			frameW = Math.max(frameW, r.w);
		} else {
			if (callee === undefined) sub.ctx.missing.push(target.ref);
			// Still loading (or failed): a placeholder in the frames' column.
			const msg =
				callee && callee !== 'loading' && 'error' in callee
					? callee.error
					: `Loading ${target.label}…`;
			const note: BoxShape = {
				...box,
				id: `${fkey}:loading`,
				kind: 'note',
				lines: wrap(msg, BOX_MAX),
				calls: [],
				x: fx,
				y: fy,
				w: Math.min(BOX_MAX, msg.length * CHAR + 24),
				h: LINE + 10,
				mayThrow: false
			};
			sub.ctx.shapes.push(note);
			fy += note.h + GAP_Y;
			frameW = Math.max(frameW, note.w);
		}
	}
	const bottom = Math.max(waitsUntil, fy - GAP_Y);
	if (bottom > y + h) {
		// The caller's line runs down past the frames to where its next step starts.
		sub.ctx.links.push({
			d: `M${cx},${y + h} L${cx},${bottom}`,
			kind: 'connector',
			label: '',
			lx: 0,
			ly: 0
		});
	}
	const width = frameW ? w + GAP_X + frameW : w;
	const block: Rect = { x, y, w: width, h: bottom - y };
	sub.placed.block.set(n.id, { x, y, w, h: bottom - y });
	return { w: block.w, h: block.h };
}

function chip(index: number, sub: Sub): CallChip {
	const call = sub.chart.calls[index];
	const { mode, note } = callMode(call, sub.chart);
	const key = `${sub.frameKey}/${index}`;
	const can = expandability(call, sub.ancestors, sub.depth);
	const targetIndex = Math.min(sub.ctx.input.chosen(key), Math.max(0, call.targets.length - 1));
	const open = can.ok && sub.ctx.input.isOpen(key, sub.depth === 0 && call.kind === 'target');
	return {
		index,
		label: call.label,
		mode,
		note:
			call.kind === 'untraced' && call.reason
				? `not traced: ${UNTRACED_WORDS[call.reason]}`
				: call.kind === 'implementations' && call.implementations
					? `${call.implementations.count} implementations of ${call.implementations.type}`
					: call.kind === 'fanout'
						? `${call.targets.length} implementations`
						: note,
		when: whenWords(call.when),
		kind: call.kind,
		reason: call.reason,
		targetLabel: call.targets[targetIndex]?.label ?? null,
		expandable: can.ok,
		why: can.ok ? null : can.why,
		blocked: can.ok ? null : can.blocked,
		open,
		key,
		targetIndex,
		targets: call.targets.map((t, i) => ({ label: t.label, index: i })),
		targetFile: call.targets[targetIndex]?.file ?? null,
		dy: 0,
		labelLines: [],
		noteLines: [],
		queries: call.queries.map((q) => ({ q, dy: 0, badgeW: 0, lines: [], flagLines: [] }))
	};
}

/** Where an exception from a call in node n goes in its caller: words for the callee
 * frame's "throws to caller". */
function exceptionTarget(cfg: Cfg, n: number): string {
	const e = cfg.edges.find((x) => x.from === n && x.kind === 'exception');
	if (!e) return 'throws to caller';
	const t = cfg.nodes[e.to];
	if (t.kind === 'dispatch' || t.kind === 'catch')
		return `→ the caller's try (line ${t.line ?? '?'})`;
	if (t.kind === 'finally' || t.kind === 'close')
		return `→ the caller's ${t.kind === 'close' ? t.text : 'finally'}`;
	return '→ not caught by the caller either: on to its caller';
}

function layoutStep(s: Step, x: number, y: number, sub: Sub): { w: number; h: number } {
	const own = ownNodes(sub.cfg, s, childrenOf(s));
	const ofKind = (k: CfgNode['kind']) => own.filter((n) => n.kind === k);
	switch (s.kind) {
		case 'stmt':
		case 'return':
		case 'throw':
		case 'break':
		case 'continue':
		case 'truncated':
			return own[0] ? placeNodeBox(own[0], x, y, sub) : { w: 0, h: 0 };
		case 'if': {
			let cy = y;
			const ev = ofKind('eval')[0];
			if (ev) cy += placeNodeBox(ev, x, cy, sub).h + GAP_Y;
			const d = ofKind('decision')[0];
			const { w: dw, h: dh } = diamond(d, x, cy, sub);
			cy += dh + GAP_Y;
			const t = layoutSeq(s.then, x, cy, sub);
			let w = Math.max(dw, t.w);
			let h = t.h;
			if (s.else?.length) {
				const ex = x + Math.max(t.w, dw) + GAP_X;
				const e = layoutSeq(s.else, ex, cy, sub);
				w = ex - x + e.w;
				h = Math.max(h, e.h);
			}
			return { w, h: cy + h - y };
		}
		case 'loop': {
			let cy = y;
			if (s.init?.length) {
				const r = layoutSeq(s.init, x, cy, sub);
				cy += r.h + GAP_Y;
			}
			const joins = ofKind('join');
			const evs = ofKind('eval');
			const d = ofKind('decision')[0];
			const top = cy;
			let w: number;
			if (s.loop === 'do') {
				dot(joins[1], x + INDENT, cy - 6, sub); // body start
				const b = layoutSeq(s.body, x + INDENT, cy, sub);
				cy += b.h + GAP_Y;
				dot(joins[2], x + INDENT, cy - 10, sub); // continue target
				if (evs[0]) cy += placeNodeBox(evs[0], x, cy, sub).h + GAP_Y;
				const dd = diamond(d, x, cy, sub);
				w = Math.max(INDENT + b.w, dd.w);
				cy += dd.h;
			} else {
				if (evs[0]) cy += placeNodeBox(evs[0], x, cy, sub).h + GAP_Y;
				const dd = diamond(d, x, cy, sub);
				w = dd.w;
				cy += dd.h + GAP_Y;
				const b = layoutSeq(s.body, x + INDENT, cy, sub);
				w = Math.max(w, INDENT + b.w);
				cy += b.h;
				const upd = own.find((n) => n.kind === 'stmt' && s.update && n.text === s.update.text);
				if (upd) {
					cy += GAP_Y;
					cy += placeNodeBox(upd, x + INDENT, cy, sub).h;
				}
				if (s.orelse?.length) {
					cy += GAP_Y;
					const o = layoutSeq(s.orelse, x, cy, sub);
					w = Math.max(w, o.w);
					cy += o.h;
				}
			}
			sub.placed.loops.set(d.id, { x, y: top, w, h: cy - top });
			dot(joins[0], x + 20, cy + 10, sub); // the loop's exit
			return { w, h: cy + 14 - y };
		}
		case 'switch': {
			let cy = y;
			const ev = ofKind('eval')[0];
			if (ev) cy += placeNodeBox(ev, x, cy, sub).h + GAP_Y;
			const d = ofKind('decision')[0];
			const { w: dw, h: dh } = diamond(d, x, cy, sub);
			cy += dh + GAP_Y;
			let cx = x;
			let h = 0;
			for (const c of s.cases) {
				if (!c.body.length) continue;
				const r = layoutSeq(c.body, cx, cy, sub);
				cx += r.w + GAP_X;
				h = Math.max(h, r.h);
			}
			dot(ofKind('join')[0], x + 20, cy + h + 12, sub);
			return { w: Math.max(dw, cx - x - GAP_X), h: cy + h + 16 - y };
		}
		case 'match': {
			let cy = y;
			const ev = ofKind('eval')[0];
			if (ev) cy += placeNodeBox(ev, x, cy, sub).h + GAP_Y;
			const decisions = ofKind('decision');
			const evals = ofKind('eval').slice(ev ? 1 : 0);
			let di = 0;
			let w = 0;
			for (const c of s.cases) {
				if (c.isDefault) {
					const r = layoutSeq(c.body, x, cy, sub);
					w = Math.max(w, r.w);
					cy += r.h + GAP_Y;
					continue;
				}
				const d = decisions[di++];
				const { w: dw, h: dh } = diamond(d, x, cy, sub);
				const bx = x + dw + GAP_X;
				let by = cy;
				if (c.guard) {
					if (c.guard.calls.length) {
						const g = evals.shift();
						if (g) by += placeNodeBox(g, bx, by, sub).h + GAP_Y;
					}
					by += diamond(decisions[di++], bx, by, sub).h + GAP_Y;
				}
				const r = layoutSeq(c.body, bx, by, sub);
				w = Math.max(w, bx - x + r.w);
				cy = Math.max(cy + dh, by + r.h) + GAP_Y;
			}
			return { w, h: cy - y };
		}
		case 'try': {
			let cy = y;
			const stmts = ofKind('stmt'); // the `open …` step of try-with-resources
			if (stmts[0] && s.resources) cy += placeNodeBox(stmts[0], x, cy, sub).h + GAP_Y;
			const region: Rect = { x: x - 6, y: cy - 6, w: 0, h: 0 };
			const b = layoutSeq(s.body, x + 8, cy + LINE, sub);
			region.w = b.w + 22;
			region.h = b.h + LINE + 12;
			sub.ctx.shapes.push({
				type: 'region',
				id: `${sub.frameKey}:try${s.line}:${x}:${y}`,
				title: 'try',
				...region
			});
			cy += region.h + GAP_Y - 6;
			let w = region.w;
			const closes = ofKind('close');
			if (s.resources && closes[0]) {
				cy += placeNodeBox(closes[0], x, cy, sub).h + GAP_Y;
			}
			if (s.orelse?.length) {
				const o = layoutSeq(s.orelse, x, cy, sub);
				w = Math.max(w, o.w);
				cy += o.h + GAP_Y;
			}
			const dispatch = ofKind('dispatch')[0];
			if (dispatch) {
				sub.placed.regions.set(dispatch.id, region);
				cy += placeNodeBox(dispatch, x, cy, sub).h + GAP_Y;
				const catches = ofKind('catch');
				let cx = x;
				let h = 0;
				s.catches.forEach((c, k) => {
					const hb = placeNodeBox(catches[k], cx, cy, sub);
					const r = layoutSeq(c.body, cx, cy + hb.h + GAP_Y, sub);
					const cw = Math.max(hb.w, r.w);
					cx += cw + GAP_X;
					h = Math.max(h, hb.h + GAP_Y + r.h);
				});
				w = Math.max(w, cx - x - GAP_X);
				cy += h + GAP_Y;
			}
			const fin = ofKind('finally')[0] ?? (s.resources ? null : closes[0]);
			if (fin) {
				cy += placeNodeBox(fin, x, cy, sub).h + GAP_Y;
				if (s.finally?.length) {
					const f = layoutSeq(s.finally, x + 8, cy, sub);
					w = Math.max(w, f.w + 8);
					cy += f.h + GAP_Y;
				}
			}
			for (const j of ofKind('join')) dot(j, x + 20, cy, sub);
			return { w, h: cy + 6 - y };
		}
		case 'with': {
			let cy = y;
			const hdr = ofKind('stmt')[0];
			if (hdr) cy += placeNodeBox(hdr, x, cy, sub).h + GAP_Y;
			const b = layoutSeq(s.body, x + 8, cy, sub);
			cy += b.h + GAP_Y;
			const close = ofKind('close')[0];
			let w = b.w + 8;
			if (close) {
				const r = placeNodeBox(close, x, cy, sub);
				w = Math.max(w, r.w);
				cy += r.h;
			}
			for (const j of ofKind('join')) dot(j, x + 20, cy + 10, sub);
			return { w, h: cy + 14 - y };
		}
		case 'block': {
			let cy = y;
			const hdr = ofKind('stmt')[0];
			let w = 0;
			if (hdr) {
				const r = placeNodeBox(hdr, x, cy, sub);
				w = r.w;
				cy += r.h + GAP_Y;
			}
			const b = layoutSeq(s.body, x + (hdr ? 8 : 0), cy, sub);
			cy += b.h;
			for (const j of ofKind('join')) dot(j, x + 20, cy + 10, sub);
			return { w: Math.max(w, b.w + 8), h: cy + 14 - y };
		}
	}
}

/** A decision: the condition wraps over up to DIAMOND_LINES lines, and the diamond
 * grows to hold them (its text area is the middle ~60% of its width). */
function diamond(n: CfgNode | undefined, x: number, y: number, sub: Sub): { w: number; h: number } {
	if (!n) return { w: 0, h: 0 };
	let w = Math.round(Math.max(170, Math.min(BOX_MAX, n.text.length * CHAR * 1.7 + 60)));
	let lines = wrap(n.text, w * 0.6);
	while (lines.length > 3 && w < BOX_MAX) {
		w = Math.min(BOX_MAX, w + 60);
		lines = wrap(n.text, w * 0.6);
	}
	lines = wrap(n.text, w * 0.6, DIAMOND_LINES);
	const h = Math.max(DIAMOND_H, 24 + lines.length * LINE * 1.5);
	const shape: DiamondShape = {
		type: 'diamond',
		id: `${sub.frameKey}:n${n.id}`,
		text: n.text,
		lines,
		fullLength: n.fullLength ?? null,
		line: n.line,
		file: sub.chart.file,
		unreachable: n.unreachable,
		x,
		y,
		w,
		h
	};
	sub.ctx.shapes.push(shape);
	sub.placed.box.set(n.id, shape);
	sub.placed.block.set(n.id, shape);
	return { w, h };
}

function dot(n: CfgNode | undefined, x: number, y: number, sub: Sub) {
	if (!n) return;
	const r = { x: x - 3, y: y - 3, w: 6, h: 6 };
	sub.ctx.shapes.push({ type: 'dot', id: `${sub.frameKey}:n${n.id}`, x, y });
	sub.placed.box.set(n.id, r);
	sub.placed.block.set(n.id, r);
}

// --- edges -----------------------------------------------------------------------------

const LOCAL: EdgeKind[] = ['next', 'yes', 'no', 'case'];

/** A call that may throw (as opposed to a `throw` statement): marked ⚡ on its box, and
 * drawn once per try region rather than one arrow per statement. */
const callMayThrow = (e: CfgEdge, cfg: Cfg) =>
	e.kind === 'exception' &&
	cfg.nodes[e.from].kind !== 'throw' &&
	cfg.nodes[e.from].kind !== 'dispatch' &&
	(cfg.nodes[e.to].kind === 'dispatch' || e.to === cfg.throws);

function drawEdges(cfg: Cfg, placed: Placed, ctx: Ctx, frameRight: number) {
	const rails = new Map<number, number>(); // dispatch / throws id → rail x
	const tryRails = new Set<number>();
	for (const e of cfg.edges) {
		const fromGroup = placed.group.get(e.from);
		if (fromGroup && fromGroup === placed.group.get(e.to)) continue; // inside one group box
		if (callMayThrow(e, cfg)) {
			// One link from the try region's edge to its dispatch; outside any try, the ⚡
			// marker says it all (its hover: "may throw, to the caller").
			const region = placed.regions.get(e.to);
			const d = placed.box.get(e.to);
			if (region && d && !tryRails.has(e.to)) {
				tryRails.add(e.to);
				const rx = region.x + region.w;
				const ry = region.y + Math.min(region.h - 10, 24);
				ctx.links.push({
					d: `M${rx},${ry} L${rx + 12},${ry} L${rx + 12},${d.y + d.h / 2} L${d.x + d.w},${d.y + d.h / 2}`,
					kind: 'exception',
					label: '⚡ may throw',
					lx: rx + 16,
					ly: ry + 12
				});
			}
			continue;
		}
		const a = placed.block.get(e.from);
		const b = placed.box.get(e.to);
		if (!a || !b) continue;
		ctx.links.push(route(e, a, b, cfg, placed, rails, frameRight, ctx));
	}
}

function route(
	e: CfgEdge,
	a: Rect,
	b: Rect,
	cfg: Cfg,
	placed: Placed,
	rails: Map<number, number>,
	frameRight: number,
	ctx: Ctx
): Link {
	const label = e.label;
	const below = b.y >= a.y + a.h - 1;
	if (e.kind === 'back') {
		const loop = placed.loops.get(e.to) ?? placed.loops.get(e.from);
		const lx = (loop?.x ?? Math.min(a.x, b.x)) + 8;
		const d = `M${a.x + 12},${a.y + a.h} L${a.x + 12},${a.y + a.h + 8} L${lx},${a.y + a.h + 8} L${lx},${b.y + b.h / 2} L${b.x},${b.y + b.h / 2}`;
		return { d, kind: e.kind, label, lx: lx + 4, ly: a.y + a.h + 18 };
	}
	if (e.kind === 'exception' && (cfg.nodes[e.to].kind === 'dispatch' || e.to === cfg.throws)) {
		// One rail per try region (or per function, to "throws to caller").
		let rx = rails.get(e.to);
		if (rx === undefined) {
			const region = placed.regions.get(e.to);
			rx = (region ? region.x + region.w : frameRight - FRAME_PAD) + 10 + rails.size * 8;
			rails.set(e.to, rx);
		}
		const d = `M${a.x + a.w},${a.y + 12} L${rx},${a.y + 12} L${rx},${b.y + b.h / 2} L${b.x + b.w},${b.y + b.h / 2}`;
		return { d, kind: e.kind, label: '', lx: rx + 4, ly: b.y + b.h / 2 - 4 };
	}
	const fromDiamondSide = e.kind === 'no' && cfg.nodes[e.from].kind === 'decision';
	const sx = fromDiamondSide ? a.x + a.w : a.x + Math.min(24, a.w / 2);
	const sy = fromDiamondSide ? a.y + a.h / 2 : a.y + a.h;
	const tx = b.x + Math.min(24, b.w / 2);
	// An elbow's vertical run must not pass through another box; otherwise this edge
	// takes the channel like a jump.
	const vx = fromDiamondSide ? Math.max(tx, sx + 14) : tx;
	const clear = ![...placed.box.values()].some(
		(r) =>
			r !== a &&
			r !== b &&
			r.w > 6 &&
			vx >= r.x - 4 &&
			vx <= r.x + r.w + 4 &&
			r.y < b.y - 2 &&
			r.y + r.h > sy + 2
	);
	if (below && clear && LOCAL.includes(e.kind)) {
		const midY = fromDiamondSide ? sy : Math.max(sy + 8, b.y - 10);
		const d = fromDiamondSide
			? `M${sx},${sy} L${Math.max(tx, sx + 14)},${sy} L${Math.max(tx, sx + 14)},${b.y} ${tx < sx + 14 ? `L${tx},${b.y}` : ''}`
			: `M${sx},${sy} L${sx},${midY} L${tx},${midY} L${tx},${b.y}`;
		return {
			d,
			kind: e.kind,
			label,
			lx: (fromDiamondSide ? sx : sx) + 4,
			ly: (fromDiamondSide ? sy : midY) - 3
		};
	}
	// Everything else (jumps, finally, exceptions to a catch, links upward) runs in a
	// channel down the right-hand side, so it never crosses a box.
	ctx.channel = (ctx.channel + 10) % 120;
	const top = Math.min(a.y, b.y);
	const bottom = Math.max(a.y + a.h, b.y + b.h);
	let right = Math.max(a.x + a.w, b.x + b.w);
	for (const r of placed.box.values())
		if (r.y < bottom && r.y + r.h > top) right = Math.max(right, r.x + r.w);
	const cx = right + 14 + ctx.channel;
	const d = `M${a.x + a.w},${a.y + Math.min(14, a.h / 2)} L${cx},${a.y + Math.min(14, a.h / 2)} L${cx},${b.y + Math.min(14, b.h / 2)} L${b.x + b.w},${b.y + Math.min(14, b.h / 2)}`;
	return { d, kind: e.kind, label, lx: cx + 4, ly: (a.y + b.y) / 2 + 8 };
}

// Full-screen view: zoom limits, and the starting view of a chart on a stage.
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;

export const clampZoom = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

/** A view of the chart: scale and offset. `clamped`: the fit wanted less than ZOOM_MIN, so
 * the view stops short at the minimum, anchored top-left, and part of the chart is off
 * screen. */
export type View = { k: number; x: number; y: number; clamped: boolean };

/** Centred on an axis when the scaled chart fits it, else starting at `pad`. */
const place = (size: number, stage: number, pad: number) =>
	size <= stage - 2 * pad ? (stage - size) / 2 : pad;

/** The whole chart, centred, never enlarged past 100% (a chart that fits is centred at
 * 100%). */
export function fitTransform(
	chartW: number,
	chartH: number,
	stageW: number,
	stageH: number,
	pad = 24
): View {
	const want = Math.min(
		1,
		(stageW - 2 * pad) / Math.max(chartW, 1),
		(stageH - 2 * pad) / Math.max(chartH, 1)
	);
	const k = clampZoom(want);
	if (want < ZOOM_MIN) return { k, x: pad, y: pad, clamped: true };
	return { k, x: (stageW - chartW * k) / 2, y: (stageH - chartH * k) / 2, clamped: false };
}

/** The opening view: the chart's width fitted (never past 100%), its top at the top; a
 * chart that fits entirely is centred. */
export function startTransform(
	chartW: number,
	chartH: number,
	stageW: number,
	stageH: number,
	pad = 24
): View {
	const want = Math.min(1, (stageW - 2 * pad) / Math.max(chartW, 1));
	const k = clampZoom(want);
	const clamped = want < ZOOM_MIN;
	return {
		k,
		x: clamped ? pad : (stageW - chartW * k) / 2,
		y: clamped ? pad : place(chartH * k, stageH, pad),
		clamped
	};
}

/** The part of the chart the stage shows, in chart coordinates. */
export function viewportRect(
	t: { k: number; x: number; y: number },
	stageW: number,
	stageH: number
): Rect {
	return { x: (0 - t.x) / t.k, y: (0 - t.y) / t.k, w: stageW / t.k, h: stageH / t.k };
}

/** The minimap's drawing: chart point p sits at (ox + p.x·s, oy + p.y·s) in a w×h box. */
export type MapFrame = {
	s: number;
	ox: number;
	oy: number;
	w: number;
	h: number;
	chartW: number;
	chartH: number;
};

/** A minimap box at most maxW×maxH with the chart scaled into it and centred. */
export function mapFrame(chartW: number, chartH: number, maxW: number, maxH: number): MapFrame {
	const s = Math.min(maxW / Math.max(chartW, 1), maxH / Math.max(chartH, 1));
	return {
		s,
		ox: (maxW - chartW * s) / 2,
		oy: (maxH - chartH * s) / 2,
		w: maxW,
		h: maxH,
		chartW,
		chartH
	};
}

/** The view that centres, at zoom k, the chart point under minimap point (mx, my)
 * (clamped to the chart, so a click in the map's margin goes to its nearest edge). */
export function minimapToTransform(
	mx: number,
	my: number,
	map: MapFrame,
	k: number,
	stageW: number,
	stageH: number
): { k: number; x: number; y: number } {
	const cx = Math.min(map.chartW, Math.max(0, (mx - map.ox) / map.s));
	const cy = Math.min(map.chartH, Math.max(0, (my - map.oy) / map.s));
	return { k, x: stageW / 2 - cx * k, y: stageH / 2 - cy * k };
}

/** Shapes whose text contains `query` (case-insensitive), in reading order. Searches what
 * is drawn: statements (in full, including grouped ones not listed), call names,
 * conditions, frame titles and pills. */
export function findMatches(scene: Scene, query: string): string[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const texts = (s: Shape): string[] => {
		if (s.type === 'box')
			return [
				s.full,
				...s.calls.map((c) => c.label),
				...s.calls.flatMap((c) => c.queries.map((x) => `${x.q.op} ${queryLine(x.q)}`))
			];
		if (s.type === 'diamond' || s.type === 'pill') return [s.text];
		if (s.type === 'frame') return [s.title];
		return [];
	};
	return scene.shapes
		.filter((s): s is Exclude<Shape, DotShape> => s.type !== 'dot')
		.filter((s) => texts(s).some((t) => t.toLowerCase().includes(q)))
		.sort((a, b) => a.y - b.y || a.x - b.x)
		.map((s) => s.id);
}

/** The calls drawn in a chart, by whether they're open and why not. */
export type ClosedSummary = { opened: number; byHand: number } & Record<Blocked, number>;

export function closedSummary(chips: CallChip[]): ClosedSummary {
	const sum: ClosedSummary = { opened: 0, byHand: 0, unresolved: 0, depth: 0, recursive: 0 };
	for (const c of chips) {
		if (c.open) sum.opened++;
		else if (c.blocked) sum[c.blocked]++;
		else sum.byHand++;
	}
	return sum;
}

/** "Opened 12 calls · 9 not resolved · 2 at the depth limit · 1 recursive". */
export function closedWords(sum: ClosedSummary): string {
	const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
	return [
		`Opened ${n(sum.opened, 'call')}`,
		sum.unresolved && `${sum.unresolved} not resolved`,
		sum.depth && `${sum.depth} at the depth limit`,
		sum.recursive && `${sum.recursive} recursive`,
		sum.byHand && `${sum.byHand} closed by hand`
	]
		.filter(Boolean)
		.join(' · ');
}
