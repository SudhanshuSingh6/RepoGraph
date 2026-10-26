// What the control-flow chart needs about one function, and the rules for showing its
// calls: how each call runs (awaited, synchronous, deferred) and whether it can be
// opened inline. Pure: the server builds `FnChart`s from stored facts, the browser
// builds each one's CFG (cfg.ts) and lays it out.

import type { FileNode } from '../graph/types.ts';
import type { Lang } from './cfg.ts';
import { callQueries, type CallQuery } from './queries.ts';
import type { Step } from './steps.ts';
import type { FnRef, StoredCall, StoredFunction, UntracedReason } from './trace.ts';

export const MAX_EXPAND_DEPTH = 5; // nested inline call frames below the handler

export type ChartTarget = {
	ref: FnRef;
	file: number;
	label: string;
	isAsync: boolean;
	springAsync: boolean;
};

export type ChartCall = {
	label: string; // `receiver.name` as written
	line: number;
	guarded: boolean;
	when: { op: string; left: string; branch?: boolean } | null;
	context: 'then' | 'timer' | 'callback' | null;
	awaited: boolean;
	isNew: boolean;
	kind: 'target' | 'fanout' | 'implementations' | 'untraced' | 'none';
	targets: ChartTarget[]; // one for `target`, up to 3 for `fanout`
	implementations: { type: string; count: number } | null;
	reason: UntracedReason | null;
	queries: CallQuery[]; // detected DB queries at this call (queries.ts)
};

export type FnChart = {
	ref: FnRef;
	file: number; // index into Graph.files
	lang: Lang;
	label: string;
	line: number;
	isAsync: boolean;
	springAsync: boolean;
	abstract: boolean;
	synthetic: boolean;
	body: Step[];
	calls: ChartCall[];
};

/** The stored function with everything the chart needs (null if it isn't stored). */
export type StoredChartFunction = Omit<StoredFunction, 'calls'> & {
	body?: Step[];
	is_async?: boolean;
	spring_async?: boolean;
	calls: (StoredCall & {
		when?: ChartCall['when'];
		context?: ChartCall['context'];
		awaited?: boolean;
		noConstructor?: boolean;
	})[];
};

const LANG: Record<string, Lang> = { java: 'java', js: 'js', ts: 'js', py: 'py' };

const fnLabel = (fn: Pick<StoredFunction, 'synthetic' | 'owner' | 'name'>) =>
	fn.synthetic ? 'inline handler' : fn.owner ? `${fn.owner}.${fn.name}` : fn.name;

export function toFnChart(
	ref: FnRef,
	functions: Map<string, StoredChartFunction[]>,
	files: FileNode[],
	fileIndex: Map<string, number>
): FnChart | null {
	const fn = functions.get(ref.path)?.[ref.fn];
	const file = fileIndex.get(ref.path);
	if (!fn || file === undefined) return null;
	const target = (r: FnRef): ChartTarget | null => {
		const t = functions.get(r.path)?.[r.fn];
		const f = fileIndex.get(r.path);
		if (!t || f === undefined) return null;
		return {
			ref: r,
			file: f,
			label: fnLabel(t),
			isAsync: t.is_async ?? false,
			springAsync: t.spring_async ?? false
		};
	};
	const calls: ChartCall[] = fn.calls.map((c) => {
		const targets = (c.target ? [c.target] : (c.fanout ?? []))
			.map(target)
			.filter((t): t is ChartTarget => t !== null);
		return {
			label: c.receiver ? `${c.receiver}.${c.name}` : c.name || '(computed)',
			line: c.line,
			guarded: c.guarded,
			when: c.when ?? null,
			context: c.context ?? null,
			awaited: c.awaited ?? false,
			isNew: c.new,
			kind: c.target
				? 'target'
				: c.fanout
					? 'fanout'
					: c.implementations
						? 'implementations'
						: c.untraced
							? 'untraced'
							: 'none',
			targets,
			implementations: c.implementations
				? { type: c.implementations.type, count: c.implementations.count }
				: null,
			reason: c.untraced ?? null,
			queries: callQueries(c, functions)
		};
	});
	return {
		ref,
		file,
		lang: LANG[files[file].lang] ?? 'js',
		label: fnLabel(fn),
		line: fn.line,
		isAsync: fn.is_async ?? false,
		springAsync: fn.spring_async ?? false,
		abstract: fn.abstract,
		synthetic: fn.synthetic,
		body: fn.body ?? [],
		calls
	};
}

/** `callback`: inside a function passed to another call (`items.map(x => f(x))`,
 * `emitter.on(…)`): it runs if and when that call invokes it — right away for `.map`,
 * later for an event handler — which the code alone doesn't say. */
export type CallMode = 'awaited' | 'sync' | 'deferred' | 'callback' | 'unknown';

/** How a call runs relative to its caller, with the words the chart shows. */
export function callMode(call: ChartCall, caller: FnChart): { mode: CallMode; note: string } {
	if (call.context === 'then' || call.context === 'timer') {
		return { mode: 'deferred', note: 'runs later, when called back' };
	}
	if (call.context === 'callback') {
		return { mode: 'callback', note: 'in a callback: runs if and when it is called' };
	}
	if (call.targets.some((t) => t.springAsync)) {
		return { mode: 'deferred', note: 'runs on another thread (@Async)' };
	}
	if (call.awaited) return { mode: 'awaited', note: 'awaited: the caller waits' };
	if (call.targets.some((t) => t.isAsync)) {
		return caller.lang === 'py'
			? { mode: 'deferred', note: 'coroutine created, not run here' }
			: { mode: 'deferred', note: 'not awaited: the caller continues' };
	}
	if (caller.lang === 'js' && caller.isAsync && call.kind !== 'target' && call.kind !== 'fanout') {
		return { mode: 'unknown', note: 'may return a promise (callee unknown)' };
	}
	return { mode: 'sync', note: '' };
}

export const refKey = (r: FnRef) => `${r.path}#${r.fn}`;

/** Why a call can't be opened inline. */
export type Blocked = 'unresolved' | 'depth' | 'recursive';

/** Can this call be opened inline, given the functions already open above it? */
export function expandability(
	call: ChartCall,
	ancestors: string[],
	depth: number
): { ok: true } | { ok: false; why: string; blocked: Blocked } {
	if (call.kind !== 'target' && call.kind !== 'fanout') {
		return { ok: false, why: 'not resolved', blocked: 'unresolved' };
	}
	if (depth >= MAX_EXPAND_DEPTH) {
		return { ok: false, why: 'deeper calls not expanded', blocked: 'depth' };
	}
	if (call.targets.every((t) => ancestors.includes(refKey(t.ref)))) {
		return {
			ok: false,
			why: `↺ recursive call to ${call.targets[0].label}`,
			blocked: 'recursive'
		};
	}
	return { ok: true };
}

/** Words for an untraced call's reason. */
export const UNTRACED_WORDS: Record<UntracedReason, string> = {
	library: 'from a library',
	global: 'a builtin or global',
	untyped: 'receiver type not declared',
	ambiguous: 'more than one candidate',
	not_found: 'not found in the resolved module or type',
	dynamic: 'computed callee'
};

/** Words for a short-circuit / ternary / optional-chain condition on a call. */
export function whenWords(w: ChartCall['when']): string | null {
	if (!w) return null;
	if (w.op === '&&' || w.op === 'and') return `only if ${w.left} is truthy`;
	if (w.op === '||' || w.op === 'or') return `only if ${w.left} is falsy`;
	if (w.op === '??') return `only if ${w.left} is null or undefined`;
	if (w.op === '?.') return `only if ${w.left} isn't null or undefined`;
	if (w.op === '?') return `only if ${w.left} is ${w.branch ? 'truthy' : 'falsy'}`;
	return null;
}
