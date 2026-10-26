// Detected DB queries, as the worker stored them (workers/queries.py, query_link.py),
// turned into call-site queries: ONE function decides which queries a call carries, and
// both the chart's badges and the endpoint's "Detected queries" list use it, so their
// counts always agree.

import type { Flow, FnRef, StoredCall, StoredFunction } from './trace.ts';

/** UPSERT: a real database upsert (ON CONFLICT, MERGE, Prisma `upsert`). SAVE: an ORM
 * save that picks insert or update from the entity's state (Spring Data / TypeORM
 * `save`, Django `update_or_create`); it may run more than one statement. */
export type QueryOp =
	'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT' | 'SAVE' | 'OTHER' | 'UNKNOWN';

export const QUERY_OPS: QueryOp[] = [
	'SELECT',
	'INSERT',
	'UPDATE',
	'DELETE',
	'UPSERT',
	'SAVE',
	'OTHER',
	'UNKNOWN'
];

/** `yes`: the call runs it; `terminal`: a lazy chain that ends in a call that runs it;
 * `unknown`: built here, run elsewhere if at all. */
export type Executes = 'yes' | 'terminal' | 'unknown';

export type Query = {
	kind: 'sql' | 'orm' | 'derived';
	orm: string;
	op: QueryOp;
	target: string | null;
	entity?: { path: string; name: string };
	text: string;
	textLength: number;
	truncated: boolean;
	executes: Executes;
	executesNote?: string;
	detail?: string; // a derived query's condition: `lastName LIKE ?% (paged)`
	predicate?: 'unknown'; // a derived condition outside the grammar
};

/** A query where it's called: the call site supplies line, conditions and context. A
 * Spring Data repository method's query (`viaRepository`) is attached at each call. */
export type CallQuery = Query & {
	line: number;
	guarded: boolean;
	when: { op: string; left: string; branch?: boolean } | null;
	context: 'then' | 'timer' | 'callback' | null;
	viaRepository: string | null; // the repository method's label
	oneOf: number | null; // one of N implementations (a fanout call)
};

type QueryCall = StoredCall & {
	query?: Query;
	when?: CallQuery['when'];
	context?: CallQuery['context'];
};

const fnLabel = (fn: Pick<StoredFunction, 'owner' | 'name'>) =>
	fn.owner ? `${fn.owner}.${fn.name}` : fn.name;

/** The queries a call carries: its own, and each resolved target's definition. */
export function callQueries(
	call: QueryCall,
	functions: Map<string, (StoredFunction & { query?: Query })[]>
): CallQuery[] {
	const site = {
		line: call.line,
		guarded: call.guarded,
		when: call.when ?? null,
		context: call.context ?? null
	};
	const out: CallQuery[] = [];
	if (call.query) out.push({ ...call.query, ...site, viaRepository: null, oneOf: null });
	const targets: FnRef[] = call.target ? [call.target] : (call.fanout ?? []);
	for (const t of targets) {
		const fn = functions.get(t.path)?.[t.fn];
		if (fn?.query) {
			out.push({
				...fn.query,
				...site,
				viaRepository: fnLabel(fn),
				oneOf: targets.length > 1 ? targets.length : null
			});
		}
	}
	return out;
}

export type DetectedQuery = CallQuery & { fn: string; file: number };

/** Every query in an endpoint's traced flow: functions in the trace's (depth-first)
 * order, calls in source order. Each code location once, even if reached twice.
 * `partial`: the trace hit a cap, so there may be more. */
export function detectedQueries(
	flow: Flow | null,
	functions: Map<string, (StoredFunction & { query?: Query })[]>
): { queries: DetectedQuery[]; partial: boolean } {
	if (!flow) return { queries: [], partial: false };
	const queries: DetectedQuery[] = [];
	for (const node of flow.nodes) {
		if (node.kind !== 'function') continue;
		const fn = functions.get(node.ref.path)?.[node.ref.fn];
		for (const call of fn?.calls ?? []) {
			for (const q of callQueries(call, functions)) {
				queries.push({ ...q, fn: node.label, file: node.file });
			}
		}
	}
	return { queries, partial: flow.truncated.depth + flow.truncated.nodes > 0 };
}

/** What `executes` means, for hover text and the list. */
export const EXECUTES_WORDS: Record<Executes, string> = {
	yes: 'runs here',
	terminal: 'runs here (the chain ends in a call that runs it)',
	unknown: 'may not execute: built here, run elsewhere if at all'
};

/** What each op means, where it isn't self-evident. */
export const OP_WORDS: Partial<Record<QueryOp, string>> = {
	UPSERT: 'a database upsert: insert, or update on conflict',
	SAVE: "insert or update, decided by the ORM from the entity's state; may run more than one statement",
	OTHER: 'schema or procedure statement (CREATE, ALTER, DROP, TRUNCATE, CALL)',
	UNKNOWN: 'the statement is not in the supported SQL subset, or is built at runtime'
};

/** The badge text for an op: UNKNOWN shows as "?". */
export const opLabel = (op: QueryOp): string => (op === 'UNKNOWN' ? '?' : op);
