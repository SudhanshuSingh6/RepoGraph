// A function's control-flow graph, built from its statement tree (steps.ts). Every path
// is an explicit, labelled edge, so the chart only has to draw what is here and the
// semantics can be tested on their own. Pure.
//
// The rules, per language (Java, JavaScript/TypeScript, Python):
// - Calls in a condition or loop header run before the decision: an `eval` node sits in
//   front of it, and a loop's back-edge returns to that `eval`, so they re-run each time.
// - while / for check before each iteration (a `no` edge is the zero-iteration path);
//   `do` checks after the body; foreach evaluates its iterable once, then "next item?".
// - Unlabelled `break` leaves the nearest loop or switch (Java/JS; Python: nearest loop);
//   `continue` goes to the nearest loop's condition (a C-style `for`'s update first).
// - Colon-style switch cases fall through to the next case; arrow cases and Python
//   `match` cases don't. Python `match` tries its cases in order.
// - Catches are tried in source order and the first applicable one wins. A thrown type
//   known with its supertypes goes to that catch only; an unknown exception (any call
//   may throw) "may match" every catch.
// - `finally` runs on every way out of its try. It is drawn once; when it completes
//   normally the pending action resumes ("then return", "then rethrow", …); a return,
//   throw, break or continue inside it replaces the pending action instead.
// - Java try-with-resources closes its resources, and a Python `with` exits its context,
//   on every way out, like an implicit finally.
// - Python `try … else` runs only when the body didn't raise, before `finally`, and its
//   exceptions skip that try's excepts; a loop's `else` runs unless the loop `break`s.

import type { Case, Catch, Part, Step } from './steps.ts';

export type Lang = 'js' | 'py' | 'java';

export type NodeKind =
	| 'entry'
	| 'exit' // normal end / return: back to the caller
	| 'throws' // an exception leaves the function
	| 'stmt'
	| 'eval' // a condition's or header's calls, before its decision
	| 'decision'
	| 'join' // where paths meet (drawn as a dot)
	| 'dispatch' // "exception raised in try": where a try's catches are chosen
	| 'catch'
	| 'finally' // the start of a finally block
	| 'close' // implicit cleanup: close resources / exit a `with` context
	| 'return'
	| 'throw'
	| 'jump' // break / continue
	| 'note'; // "n more statements not shown"

export type CfgNode = {
	id: number;
	kind: NodeKind;
	text: string;
	line: number | null;
	calls: number[];
	unreachable: boolean;
	/** A return/throw/break/continue inside a finally that replaces the pending action. */
	overrides?: boolean;
	/** The statement's length when the worker shortened its text. */
	fullLength?: number;
};

export type EdgeKind =
	| 'next'
	| 'yes'
	| 'no'
	| 'case'
	| 'back' // a loop's repeat
	| 'jump' // break / continue / return
	| 'exception'
	| 'finally'; // into a finally, or out of it to resume the pending action

export type CfgEdge = { from: number; to: number; kind: EdgeKind; label: string };

export type Cfg = {
	nodes: CfgNode[];
	edges: CfgEdge[];
	entry: number;
	exit: number;
	throws: number;
	/** The node ids each step created, [start, end), nested steps included. */
	ranges: Map<Step, [number, number]>;
};

/** Library and framework exception types and their parents, for matching a thrown type
 * whose repo-resolved chain ends outside the repo. */
const BUILTIN_PARENT: Record<string, string> = {
	// Java
	Throwable: '',
	Exception: 'Throwable',
	Error: 'Throwable',
	RuntimeException: 'Exception',
	IOException: 'Exception',
	InterruptedException: 'Exception',
	IllegalArgumentException: 'RuntimeException',
	NumberFormatException: 'IllegalArgumentException',
	IllegalStateException: 'RuntimeException',
	NullPointerException: 'RuntimeException',
	IndexOutOfBoundsException: 'RuntimeException',
	UnsupportedOperationException: 'RuntimeException',
	ArithmeticException: 'RuntimeException',
	ClassCastException: 'RuntimeException',
	ResponseStatusException: 'RuntimeException',
	DataAccessException: 'RuntimeException',
	EmptyResultDataAccessException: 'DataAccessException',
	// Python
	BaseException: '',
	SystemExit: 'BaseException',
	KeyboardInterrupt: 'BaseException',
	ValueError: 'Exception',
	TypeError: 'Exception',
	LookupError: 'Exception',
	KeyError: 'LookupError',
	IndexError: 'LookupError',
	RuntimeError: 'Exception',
	NotImplementedError: 'RuntimeError',
	AttributeError: 'Exception',
	OSError: 'Exception',
	FileNotFoundError: 'OSError',
	PermissionError: 'OSError',
	ArithmeticError: 'Exception',
	ZeroDivisionError: 'ArithmeticError',
	Http404: 'Exception',
	PermissionDenied: 'Exception',
	ObjectDoesNotExist: 'Exception',
	HTTPException: 'Exception'
};
// Python's `Exception` sits under BaseException; Java's under Throwable. Both spellings
// resolve through the table; the language decides which root applies.
const ROOTS: Record<Lang, string[]> = { java: ['Throwable'], py: ['BaseException'], js: [] };

const simple = (t: string) => t.slice(t.lastIndexOf('.') + 1).replace(/<.*$/, '');

/** Does a thrown type (its resolved chain) fall under `catchType`? true / false /
 * 'maybe' when the chain leaves the repo at a type this table doesn't know. */
export function subtypeOf(
	chain: string[],
	complete: boolean,
	catchType: string,
	lang: Lang
): boolean | 'maybe' {
	const want = simple(catchType);
	if (chain.some((t) => simple(t) === want)) return true;
	let tail = simple(chain[chain.length - 1]);
	if (complete) return false;
	// Walk the builtin table from where the repo chain ended.
	const seen = new Set<string>();
	while (tail && !seen.has(tail)) {
		if (tail === want) return true;
		seen.add(tail);
		const parent = lang === 'py' && tail === 'Exception' ? 'BaseException' : BUILTIN_PARENT[tail];
		if (parent === undefined) return 'maybe'; // a type we know nothing about
		tail = parent;
	}
	return ROOTS[lang].includes(want) ? true : false;
}

/** A catch clause as written: `catch (A | B e)`, `except (A, B) as e`, `except:`. */
function catchText(c: Catch, lang: Lang): string {
	if (lang === 'py') {
		if (c.types === null) return 'except: (any exception)';
		const t = c.types.length > 1 ? `(${c.types.join(', ')})` : c.types[0];
		return `except ${t}${c.name ? ` as ${c.name}` : ''}`;
	}
	if (c.types === null) return `catch ${c.name ? `(${c.name})` : '(any exception)'}`;
	return `catch (${c.types.join(' | ')}${c.name ? ` ${c.name}` : ''})`;
}

/** A catch that takes any exception at all. (`catch (Exception e)` doesn't: Errors /
 * SystemExit / KeyboardInterrupt get past it.) */
function catchesAll(c: Catch, lang: Lang): boolean {
	if (c.types === null) return true;
	return c.types.some((t) =>
		lang === 'java' ? simple(t) === 'Throwable' : simple(t) === 'BaseException'
	);
}

type Pending = { from: number; kind: EdgeKind; label: string };

type ThrowInfo = { chain: string[] | null; complete: boolean };
type Action =
	| { kind: 'return' }
	| { kind: 'break' | 'continue'; target: number } // frame index
	| { kind: 'throw'; info: ThrowInfo };

type Frame =
	| { type: 'loop'; label: string | null; breakTo: number; continueTo: number }
	| { type: 'switch'; label: string | null; breakTo: number }
	| { type: 'block'; label: string | null; breakTo: number }
	| {
			type: 'try';
			region: 'body' | 'else' | 'catch';
			catches: { catch: Catch; node: number }[];
			dispatch: number | null;
			dispatchOut: boolean; // its "not caught here" edge is wired
			requests: { pending: Pending[]; action: Action }[] | null; // null: no finally
	  };

const actionLabel = (a: Action) =>
	a.kind === 'throw' ? 'exception' : a.kind === 'return' ? 'return' : a.kind;

export function buildCfg(body: Step[], lang: Lang): Cfg {
	const nodes: CfgNode[] = [];
	const edges: CfgEdge[] = [];
	const frames: Frame[] = [];
	const ranges = new Map<Step, [number, number]>();
	let finallyDepth = 0;

	const node = (kind: NodeKind, text: string, line: number | null, calls: number[] = []) => {
		const n: CfgNode = { id: nodes.length, kind, text, line, calls, unreachable: false };
		if (finallyDepth > 0 && (kind === 'return' || kind === 'throw' || kind === 'jump'))
			n.overrides = true;
		nodes.push(n);
		return n.id;
	};
	const edge = (from: number, to: number, kind: EdgeKind, label: string) => {
		if (!edges.some((e) => e.from === from && e.to === to && e.kind === kind && e.label === label))
			edges.push({ from, to, kind, label });
	};
	const connect = (incoming: Pending[], to: number) => {
		for (const p of incoming) edge(p.from, to, p.kind, p.label);
	};
	const next = (from: number, label = ''): Pending[] => [{ from, kind: 'next', label }];

	const entry = node('entry', 'start', null);
	const exit = node('exit', 'end → back to caller', null);
	const throws = node('throws', 'throws to caller', null);

	// --- transfers: return, break, continue, throw -----------------------------------

	/** Sends pending control outward from frame `start - 1` until it reaches its target,
	 * stopping at any finally on the way (which resumes it when it completes). */
	function transfer(pending: Pending[], action: Action, start = frames.length) {
		if (!pending.length) return;
		for (let i = start - 1; i >= 0; i--) {
			const f = frames[i];
			if ((action.kind === 'break' || action.kind === 'continue') && action.target === i) {
				const to =
					action.kind === 'break'
						? (f as { breakTo: number }).breakTo
						: (f as { continueTo: number }).continueTo;
				connect(
					pending.map((p) => ({
						...p,
						kind: p.kind === 'finally' ? 'finally' : 'jump',
						label: p.label || action.kind
					})),
					to
				);
				return;
			}
			if (f.type !== 'try') continue;
			if (action.kind === 'throw' && f.region === 'body' && f.catches.length) {
				const uncaught = dispatchThrow(pending, action.info, f, i);
				if (!uncaught.length) return;
				pending = uncaught;
			}
			if (f.requests) {
				f.requests.push({ pending, action });
				return;
			}
		}
		if (action.kind === 'throw') {
			connect(
				pending.map((p) => ({
					...p,
					kind: p.kind === 'finally' ? 'finally' : 'exception',
					label: p.label || 'throws to caller'
				})),
				throws
			);
		} else if (action.kind === 'return') {
			connect(
				pending.map((p) => ({
					...p,
					kind: p.kind === 'finally' ? 'finally' : 'jump',
					label: p.label || 'return'
				})),
				exit
			);
		}
	}

	/** An exception raised in a try body: which catches it reaches (source order, first
	 * applicable wins). Returns what isn't caught here, to continue outward. */
	/** A pending edge's label, keeping "then rethrow" when it comes out of a finally. */
	const lab = (p: Pending, label: string) =>
		p.kind === 'finally' && p.label ? `${p.label} · ${label}` : label;

	function dispatchThrow(
		pending: Pending[],
		info: ThrowInfo,
		f: Extract<Frame, { type: 'try' }>,
		i: number
	): Pending[] {
		if (info.chain === null) {
			// Unknown type (a call, a re-raise): through the dispatch, "may match" each catch.
			connect(
				pending.map((p) => ({ ...p, kind: 'exception', label: lab(p, 'may throw') })),
				f.dispatch!
			);
			if (!f.dispatchOut) {
				f.dispatchOut = true;
				for (const { catch: c, node: n } of f.catches)
					edge(f.dispatch!, n, 'exception', catchesAll(c, lang) ? 'matches' : 'may match');
				if (!f.catches.some((c) => catchesAll(c.catch, lang))) {
					// Wired once, from the dispatch, as an unknown exception leaving this try.
					const out: Pending[] = [
						{ from: f.dispatch!, kind: 'exception', label: 'not caught here' }
					];
					const saved = f.region;
					f.region = 'catch'; // past the catches; still through this try's finally
					transfer(out, { kind: 'throw', info }, i + 1);
					f.region = saved;
				}
			}
			return [];
		}
		for (const { catch: c, node: n } of f.catches) {
			const m =
				c.types === null
					? true
					: c.types.reduce<boolean | 'maybe'>((acc, t) => {
							const r = subtypeOf(info.chain!, info.complete, t, lang);
							return acc === true || r === true
								? true
								: acc === 'maybe' || r === 'maybe'
									? 'maybe'
									: false;
						}, false);
			if (m === true) {
				connect(
					pending.map((p) => ({ ...p, kind: 'exception', label: lab(p, 'matches') })),
					n
				);
				return [];
			}
			if (m === 'maybe')
				connect(
					pending.map((p) => ({ ...p, kind: 'exception', label: lab(p, 'may match') })),
					n
				);
		}
		return pending.map((p) => ({ ...p, label: lab(p, 'not caught here') }));
	}

	/** Any call may throw: an exception edge from each node with calls. */
	function mayThrow(n: number) {
		if (nodes[n].calls.length)
			transfer([{ from: n, kind: 'exception', label: 'may throw' }], {
				kind: 'throw',
				info: { chain: null, complete: false }
			});
	}

	// --- statements ----------------------------------------------------------------------

	function seq(steps: Step[], incoming: Pending[]): Pending[] {
		let cur = incoming;
		for (const s of steps) cur = step(s, cur);
		return cur;
	}

	/** A decision, preceded by an `eval` node when its condition makes calls. Returns
	 * [the node to enter (and loop back to), the decision]. */
	function decide(part: Part, text: string, line: number, incoming: Pending[]): [number, number] {
		let first: number;
		if (part.calls.length) {
			first = node('eval', part.text, line, part.calls);
			nodes[first].fullLength = part.fullLength;
			connect(incoming, first);
			mayThrow(first);
			const d = node('decision', text, line);
			nodes[d].fullLength = part.fullLength;
			edge(first, d, 'next', '');
			return [first, d];
		}
		first = node('decision', text, line);
		nodes[first].fullLength = part.fullLength;
		connect(incoming, first);
		return [first, first];
	}

	function findTarget(kind: 'break' | 'continue', label: string | null): number {
		for (let i = frames.length - 1; i >= 0; i--) {
			const f = frames[i];
			if (label !== null) {
				if ('label' in f && f.label === label && (kind === 'break' || f.type === 'loop')) return i;
				continue;
			}
			if (f.type === 'loop') return i;
			if (kind === 'break' && f.type === 'switch' && lang !== 'py') return i;
		}
		return -1;
	}

	/** Builds one step, recording the range of node ids it created (its own nodes and
	 * those of the steps nested in it) for the layout. */
	function step(s: Step, incoming: Pending[]): Pending[] {
		const start = nodes.length;
		const out = stepInner(s, incoming);
		ranges.set(s, [start, nodes.length]);
		return out;
	}

	function stepInner(s: Step, incoming: Pending[]): Pending[] {
		switch (s.kind) {
			case 'stmt': {
				const n = node('stmt', s.text, s.line, s.calls);
				nodes[n].fullLength = s.fullLength;
				connect(incoming, n);
				mayThrow(n);
				return next(n);
			}
			case 'truncated': {
				const n = node('note', `${s.omitted} more statements not shown`, s.line ?? null);
				connect(incoming, n);
				return next(n);
			}
			case 'block': {
				let cur = incoming;
				if (s.calls?.length || s.text !== '{ … }') {
					const h = node('stmt', s.text, s.line, s.calls ?? []);
					connect(cur, h);
					mayThrow(h);
					cur = next(h);
				}
				if (s.label === null) return seq(s.body, cur);
				const join = node('join', '', null);
				frames.push({ type: 'block', label: s.label, breakTo: join });
				const out = seq(s.body, cur);
				frames.pop();
				connect(out, join);
				return next(join);
			}
			case 'return': {
				const n = node('return', s.text, s.line, s.value?.calls ?? []);
				nodes[n].fullLength = s.fullLength;
				connect(incoming, n);
				mayThrow(n);
				transfer(next(n), { kind: 'return' });
				return [];
			}
			case 'throw': {
				const n = node('throw', s.text, s.line, s.value?.calls ?? []);
				nodes[n].fullLength = s.fullLength;
				connect(incoming, n);
				mayThrow(n);
				const chain = s.typeChain ?? (s.type ? [s.type] : null);
				transfer([{ from: n, kind: 'exception', label: '' }], {
					kind: 'throw',
					info: { chain, complete: s.chainComplete ?? false }
				});
				return [];
			}
			case 'break':
			case 'continue': {
				const n = node('jump', s.label ? `${s.kind} ${s.label}` : s.kind, s.line);
				connect(incoming, n);
				const target = findTarget(s.kind, s.label);
				if (target >= 0)
					transfer([{ from: n, kind: 'jump', label: s.kind }], { kind: s.kind, target });
				return [];
			}
			case 'if': {
				const [, d] = decide(s.cond, s.cond.text, s.line, incoming);
				const out = seq(s.then, [{ from: d, kind: 'yes', label: 'yes' }]);
				const no: Pending[] = [{ from: d, kind: 'no', label: 'no' }];
				return [...out, ...(s.else ? seq(s.else, no) : no)];
			}
			case 'loop':
				return loop(s, incoming);
			case 'switch':
				return switchStep(s, incoming);
			case 'match':
				return matchStep(s, incoming);
			case 'try':
				return tryStep(
					incoming,
					s.catches,
					s.finally,
					s.orelse,
					s.resources
						? (inc) => {
								const r = node('stmt', `open ${s.resources!.text}`, s.line, s.resources!.calls);
								connect(inc, r);
								mayThrow(r);
								// The resources close on every way out of the body, before any catch.
								return tryStep(
									next(r),
									[],
									null,
									null,
									(i2) => seq(s.body, i2),
									'close resources',
									s.line
								);
							}
						: (inc) => seq(s.body, inc),
					null,
					s.line
				);
			case 'with': {
				const h = node('stmt', `with ${s.items.text}`, s.line, s.items.calls);
				connect(incoming, h);
				mayThrow(h);
				return tryStep(
					next(h),
					[],
					null,
					null,
					(inc) => seq(s.body, inc),
					'exit the `with` context',
					s.line
				);
			}
		}
	}

	function loop(s: Extract<Step, { kind: 'loop' }>, incoming: Pending[]): Pending[] {
		const exitJoin = node('join', '', null);
		let cur = incoming;
		if (s.init?.length) cur = seq(s.init, cur);
		const infinite = !s.cond || ['true', 'True', '1'].includes(s.cond.text);
		const label = s.label;

		if (s.loop === 'do') {
			const bodyStart = node('join', '', s.line);
			connect(cur, bodyStart);
			// `continue` jumps to the condition, which isn't built yet: a placeholder join.
			const condEntry = node('join', '', null);
			frames.push({ type: 'loop', label, breakTo: exitJoin, continueTo: condEntry });
			const out = seq(s.body, next(bodyStart));
			frames.pop();
			connect(out, condEntry);
			const [, d] = decide(
				s.cond ?? { text: 'true', calls: [] },
				s.cond?.text ?? 'true',
				s.line,
				next(condEntry)
			);
			edge(d, bodyStart, 'back', 'yes · repeat');
			if (!infinite) edge(d, exitJoin, 'no', 'no');
			return next(exitJoin);
		}

		let top: number; // where each iteration starts (and `continue` / repeat lead)
		let d: number;
		if (s.loop === 'foreach') {
			let c2 = cur;
			if (s.iterable) {
				if (s.iterable.calls.length) {
					const ev = node('eval', s.iterable.text, s.line, s.iterable.calls);
					connect(c2, ev);
					mayThrow(ev);
					c2 = next(ev); // evaluated once, before the first iteration
				}
			}
			d = node('decision', `next ${s.item ?? 'item'} in ${s.iterable?.text ?? '…'}?`, s.line);
			connect(c2, d);
			top = d;
		} else {
			[top, d] = decide(
				s.cond ?? { text: 'true', calls: [] },
				s.cond?.text ?? '(no condition)',
				s.line,
				cur
			);
		}
		let continueTo = top;
		let updateNode: number | null = null;
		if (s.loop === 'for' && s.update) {
			updateNode = node('stmt', s.update.text, s.line, s.update.calls);
			continueTo = updateNode;
		}
		frames.push({ type: 'loop', label, breakTo: exitJoin, continueTo });
		const out = seq(s.body, [
			{ from: d, kind: 'yes', label: s.loop === 'foreach' ? 'next item' : 'yes' }
		]);
		frames.pop();
		if (updateNode !== null) {
			connect(out, updateNode);
			mayThrow(updateNode);
			edge(updateNode, top, 'back', 'repeat');
		} else {
			connect(
				out.map((p) => ({ ...p, kind: 'back', label: 'repeat' })),
				top
			);
		}
		if (!infinite || s.loop === 'foreach') {
			const done: Pending[] = [
				{ from: d, kind: 'no', label: s.loop === 'foreach' ? 'no more items' : 'no' }
			];
			connect(s.orelse ? seq(s.orelse, done) : done, exitJoin);
		}
		return next(exitJoin);
	}

	function switchStep(s: Extract<Step, { kind: 'switch' }>, incoming: Pending[]): Pending[] {
		const exitJoin = node('join', '', null);
		const [, d] = decide(s.subject, `switch (${s.subject.text})`, s.line, incoming);
		frames.push({ type: 'switch', label: s.label, breakTo: exitJoin });
		let fall: Pending[] = [];
		let labels: string[] = [];
		s.cases.forEach((c: Case, k: number) => {
			labels.push(c.isDefault ? 'default' : `case ${c.labels.join(', ')}`);
			if (!c.body.length && !s.arrow && k < s.cases.length - 1) return; // grouped labels
			const into: Pending[] = [{ from: d, kind: 'case', label: labels.join(' / ') }, ...fall];
			labels = [];
			const out = seq(c.body, into);
			if (s.arrow) connect(out, exitJoin);
			else fall = out.map((p) => ({ ...p, label: 'falls through' }));
		});
		if (!s.arrow)
			connect(
				fall.map((p) => (p.label === 'falls through' ? { ...p, label: '' } : p)),
				exitJoin
			);
		frames.pop();
		if (!s.hasDefault) edge(d, exitJoin, 'no', 'no case matched');
		return next(exitJoin);
	}

	function matchStep(s: Extract<Step, { kind: 'match' }>, incoming: Pending[]): Pending[] {
		let cur = incoming;
		if (s.subject.calls.length) {
			const ev = node('eval', s.subject.text, s.line, s.subject.calls);
			connect(cur, ev);
			mayThrow(ev);
			cur = next(ev);
		}
		const done: Pending[] = [];
		for (const c of s.cases) {
			if (c.isDefault) {
				done.push(
					...seq(
						c.body,
						cur.map((p) => ({ ...p, label: p.label || 'case _' }))
					)
				);
				cur = [];
				break;
			}
			const d = node('decision', `${s.subject.text} matches ${c.labels.join(' | ')}?`, c.line);
			connect(cur, d);
			let yes: Pending[] = [{ from: d, kind: 'yes', label: 'yes' }];
			let failed: Pending[] = [{ from: d, kind: 'no', label: 'no' }];
			if (c.guard) {
				const [, gd] = decide(c.guard, `if ${c.guard.text}`, c.line, yes);
				yes = [{ from: gd, kind: 'yes', label: 'yes' }];
				failed = [...failed, { from: gd, kind: 'no', label: 'no' }];
			}
			done.push(...seq(c.body, yes));
			cur = failed;
		}
		// No case matched: carry on after the match.
		return [
			...done,
			...cur.map((p) => ({ ...p, label: p.label === 'no' ? 'no case matched' : p.label }))
		];
	}

	/** try / catch / else / finally. `bodyFn` builds the protected body; `closeText`
	 * makes the finally an implicit cleanup node (resources, `with`). */
	function tryStep(
		incoming: Pending[],
		catches: Catch[],
		finallySteps: Step[] | null,
		orelse: Step[] | null,
		bodyFn: (inc: Pending[]) => Pending[],
		closeText: string | null = null,
		line: number | null = null
	): Pending[] {
		const hasFinally = finallySteps !== null || closeText !== null;
		const catchNodes = catches.map((c) => node('catch', catchText(c, lang), c.line));
		// The dispatch's edges to the catches are wired when an unknown exception first
		// reaches it (dispatchThrow); a known throw goes straight to its catch.
		const dispatch = catches.length ? node('dispatch', 'exception raised in try', line) : null;
		const frame: Extract<Frame, { type: 'try' }> = {
			type: 'try',
			region: 'body',
			catches: catches.map((c, k) => ({ catch: c, node: catchNodes[k] })),
			dispatch,
			dispatchOut: false,
			requests: hasFinally ? [] : null
		};
		frames.push(frame);
		let normal = bodyFn(incoming);
		if (orelse) {
			frame.region = 'else';
			normal = seq(orelse, normal);
		}
		frame.region = 'catch';
		for (let k = 0; k < catches.length; k++)
			normal = [...normal, ...seq(catches[k].body, next(catchNodes[k]))];
		frames.pop();
		if (!hasFinally) return normal;

		const requests = frame.requests!;
		const fin = node(closeText ? 'close' : 'finally', closeText ?? 'finally', line);
		connect(
			normal.map((p) => ({ ...p, kind: 'finally', label: 'normal' })),
			fin
		);
		for (const r of requests)
			connect(
				r.pending.map((p) => ({ ...p, kind: 'finally', label: `on ${actionLabel(r.action)}` })),
				fin
			);
		let end: Pending[];
		if (closeText) end = next(fin);
		else {
			finallyDepth++;
			end = seq(finallySteps!, next(fin));
			finallyDepth--;
		}
		if (!end.length) return []; // the finally always exits abruptly: it overrides everything
		const endJoin = node('join', '', null);
		connect(end, endJoin);
		// Resume each pending action that came in, once, from the finally's normal end.
		const seen = new Set<string>();
		for (const r of requests) {
			const key = JSON.stringify(r.action);
			if (seen.has(key)) continue;
			seen.add(key);
			const label = r.action.kind === 'throw' ? 'then rethrow' : `then ${r.action.kind}`;
			transfer([{ from: endJoin, kind: 'finally', label }], r.action);
		}
		return normal.length ? next(endJoin) : [];
	}

	const out = seq(body, next(entry));
	connect(
		out.map((p) => ({ ...p, label: p.label || 'end' })),
		exit
	);

	// Reachability: what can't be reached from the entry is dimmed, not hidden.
	const reach = new Set([entry]);
	const queue = [entry];
	while (queue.length) {
		const n = queue.pop()!;
		for (const e of edges)
			if (e.from === n && !reach.has(e.to)) {
				reach.add(e.to);
				queue.push(e.to);
			}
	}
	for (const n of nodes) n.unreachable = !reach.has(n.id) && n.kind !== 'join';
	return { nodes, edges, entry, exit, throws, ranges };
}

/** The nodes a step created itself, in creation order: its range minus the ranges of
 * the steps nested in it. */
export function ownNodes(cfg: Cfg, s: Step, children: Step[]): CfgNode[] {
	const r = cfg.ranges.get(s);
	if (!r) return [];
	const inner = children.map((c) => cfg.ranges.get(c)).filter((x): x is [number, number] => !!x);
	const out: CfgNode[] = [];
	for (let id = r[0]; id < r[1]; id++)
		if (!inner.some(([a, b]) => id >= a && id < b)) out.push(cfg.nodes[id]);
	return out;
}

/** Edges between visible nodes, with join dots collapsed: for tests and summaries. */
export function visibleEdges(
	cfg: Cfg
): { from: string; to: string; kind: EdgeKind; label: string }[] {
	const name = (id: number) => {
		const n = cfg.nodes[id];
		return n.kind === 'entry' || n.kind === 'exit' || n.kind === 'throws'
			? n.kind
			: `${n.kind}:${n.text}`;
	};
	const out: { from: string; to: string; kind: EdgeKind; label: string }[] = [];
	const ends = (id: number, seen = new Set<number>()): number[] => {
		if (cfg.nodes[id].kind !== 'join') return [id];
		if (seen.has(id)) return [];
		seen.add(id);
		return cfg.edges.filter((e) => e.from === id).flatMap((e) => ends(e.to, seen));
	};
	for (const e of cfg.edges) {
		if (cfg.nodes[e.from].kind === 'join') continue;
		for (const t of ends(e.to)) {
			const via =
				cfg.nodes[e.to].kind === 'join'
					? cfg.edges.find((x) => x.from === e.to && ends(x.to).includes(t))
					: null;
			const label = e.label || via?.label || '';
			const item = { from: name(e.from), to: name(t), kind: e.kind, label };
			if (!out.some((o) => o.from === item.from && o.to === item.to && o.label === item.label))
				out.push(item);
		}
	}
	return out;
}
