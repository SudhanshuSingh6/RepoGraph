// The static call flow behind one endpoint: a depth-first walk, in call order, over the
// calls the worker already resolved (workers/call_resolve.py), capped in depth and size.
// It only follows what was resolved; everything else is counted on the node it came
// from, with the reason. Pure: stored facts in, a graph out.
//
// A function's depth is its *shortest* call depth from the handler, worked out before
// the walk, not the level at which the walk happens to reach it first. Each function is
// expanded once; because its depth is already final, a long way round found first can't
// push it past the depth limit and hide calls that are within reach by a shorter path.

export const MAX_DEPTH = 5; // call levels below the handler
export const MAX_NODES = 40; // function and implementation nodes per flow
export const MAX_UNTRACED_LISTED = 20;

export type UntracedReason =
	'library' | 'global' | 'untyped' | 'ambiguous' | 'not_found' | 'dynamic';

export type FnRef = { path: string; fn: number };

/** A call as the worker stored it: exactly one of target / fanout / implementations /
 * untraced is set. */
export type StoredCall = {
	receiver: string | null;
	name: string;
	line: number;
	guarded: boolean;
	args: number;
	new: boolean;
	target?: FnRef;
	fanout?: FnRef[];
	implementations?: { path: string; type: string; count: number };
	untraced?: UntracedReason;
};

export type StoredFunction = {
	name: string;
	owner: string | null;
	line: number;
	end_line: number;
	synthetic: boolean;
	abstract: boolean;
	calls: StoredCall[];
};

export type Layer = 'handler' | 'controller' | 'service' | 'repository' | 'other';

export type FlowNode =
	| {
			id: number;
			kind: 'function';
			depth: number;
			file: number; // index into Graph.files
			label: string;
			line: number;
			layer: Layer;
			abstract: boolean;
			synthetic: boolean;
			untraced: Partial<Record<UntracedReason, number>>;
			untracedCalls: { name: string; reason: UntracedReason; line: number }[];
	  }
	| {
			id: number;
			kind: 'implementations';
			depth: number;
			file: number;
			type: string;
			count: number;
	  }
	| { id: number; kind: 'more'; depth: number; calls: number; limit: 'depth' | 'nodes' };

/** One or more calls from `from` to `to`. Conditional only if every one of them is
 * guarded; `back` closes a cycle (the target is already on the path to `from`). */
export type FlowEdge = {
	from: number;
	to: number;
	lines: number[];
	conditional: boolean;
	back: boolean;
};

export type Flow = {
	nodes: FlowNode[];
	edges: FlowEdge[];
	/** Calls not followed because of each cap; both zero means the trace is complete. */
	truncated: { depth: number; nodes: number };
};

const SUFFIX: [RegExp, Layer][] = [
	[/(Controller|Resource|View|ViewSet|Handler|Router)$/, 'controller'],
	[/(Service|Manager|UseCase|Interactor)$/, 'service'],
	[/(Repository|Repo|Dao|DAO|Store|Mapper)$/, 'repository']
];
const FOLDER: [RegExp, Layer][] = [
	[/(^|\/)(controllers?|views|routes|handlers|api)\//, 'controller'],
	[/(^|\/)(services?|usecases)\//, 'service'],
	[/(^|\/)(repositories|repository|repos|dao|daos)\//, 'repository']
];

/** A heuristic label only: the class-name suffix, else (for a module-level function)
 * the file name's (`article.service.ts` → service), else the folder. */
export function layerOf(owner: string | null, path: string): Layer {
	const stem = path
		.slice(path.lastIndexOf('/') + 1)
		.replace(/\.[^.]+$/, '')
		.replace(/[._-](\w)/g, (_, c: string) => c.toUpperCase());
	const name = owner ?? stem;
	for (const [re, layer] of SUFFIX) if (re.test(name)) return layer;
	const dir = path.replace(/[^/]+$/, '');
	for (const [re, layer] of FOLDER) if (re.test(dir)) return layer;
	return 'other';
}

export function traceEndpoint(
	start: FnRef,
	functions: Map<string, StoredFunction[]>,
	fileIndex: Map<string, number>
): Flow | null {
	const fnAt = (r: FnRef) => functions.get(r.path)?.[r.fn];
	if (!fnAt(start) || !fileIndex.has(start.path)) return null;
	const key = (r: FnRef) => `${r.path}#${r.fn}`;
	const targetsOf = (call: StoredCall) => (call.target ? [call.target] : (call.fanout ?? []));

	// Shortest call depths, breadth-first, as far as one level past the limit. Anything
	// missing from this map is deeper than that.
	const shortest = new Map<string, number>([[key(start), 0]]);
	const queue: FnRef[] = [start];
	for (let i = 0; i < queue.length; i++) {
		const d = shortest.get(key(queue[i]))!;
		if (d >= MAX_DEPTH) continue;
		for (const call of fnAt(queue[i])!.calls) {
			for (const t of targetsOf(call)) {
				if (!fnAt(t) || !fileIndex.has(t.path) || shortest.has(key(t))) continue;
				shortest.set(key(t), d + 1);
				queue.push(t);
			}
		}
	}
	const depthOf = (r: FnRef) => shortest.get(key(r)) ?? Infinity;

	const nodes: FlowNode[] = [];
	const edges: FlowEdge[] = [];
	const idOf = new Map<string, number>();
	const truncated = { depth: 0, nodes: 0 };
	let counted = 0; // function + implementations nodes, against MAX_NODES

	const addEdge = (from: number, to: number, line: number, guarded: boolean, back: boolean) => {
		const e = edges.find((x) => x.from === from && x.to === to);
		if (e) {
			e.lines.push(line);
			e.conditional = e.conditional && guarded;
			e.back = e.back || back;
		} else edges.push({ from, to, lines: [line], conditional: guarded, back });
	};

	const more = new Map<string, number>(); // `${from}:${limit}` → stub node id
	const stub = (from: number, depth: number, limit: 'depth' | 'nodes') => {
		const k = `${from}:${limit}`;
		let id = more.get(k);
		if (id === undefined) {
			id = nodes.length;
			nodes.push({ id, kind: 'more', depth, calls: 0, limit });
			more.set(k, id);
			edges.push({ from, to: id, lines: [], conditional: false, back: false });
		}
		(nodes[id] as Extract<FlowNode, { kind: 'more' }>).calls++;
		truncated[limit]++;
	};

	const newFunctionNode = (r: FnRef, depth: number): number => {
		const fn = fnAt(r)!;
		const id = nodes.length;
		nodes.push({
			id,
			kind: 'function',
			depth,
			file: fileIndex.get(r.path)!,
			label: fn.synthetic ? 'inline handler' : fn.owner ? `${fn.owner}.${fn.name}` : fn.name,
			line: fn.line,
			layer: depth === 0 ? 'handler' : layerOf(fn.owner, r.path),
			abstract: fn.abstract,
			synthetic: fn.synthetic,
			untraced: {},
			untracedCalls: []
		});
		idOf.set(key(r), id);
		counted++;
		return id;
	};

	const visit = (r: FnRef, id: number, depth: number, onPath: Set<string>) => {
		const fn = fnAt(r)!;
		const node = nodes[id] as Extract<FlowNode, { kind: 'function' }>;
		for (const call of fn.calls) {
			if (call.untraced) {
				node.untraced[call.untraced] = (node.untraced[call.untraced] ?? 0) + 1;
				if (node.untracedCalls.length < MAX_UNTRACED_LISTED) {
					const name = call.receiver ? `${call.receiver}.${call.name}` : call.name;
					node.untracedCalls.push({
						name: name || '(computed)',
						reason: call.untraced,
						line: call.line
					});
				}
				continue;
			}
			if (call.implementations) {
				if (depth + 1 > MAX_DEPTH) stub(id, depth + 1, 'depth');
				else if (counted >= MAX_NODES) stub(id, depth + 1, 'nodes');
				else {
					const impl = call.implementations;
					const iid = nodes.length;
					nodes.push({
						id: iid,
						kind: 'implementations',
						depth: depth + 1,
						file: fileIndex.get(impl.path) ?? -1,
						type: impl.type,
						count: impl.count
					});
					counted++;
					addEdge(id, iid, call.line, call.guarded, false);
				}
				continue;
			}
			for (const t of targetsOf(call)) {
				if (!fnAt(t) || !fileIndex.has(t.path)) continue;
				const k = key(t);
				if (onPath.has(k)) {
					addEdge(id, idOf.get(k)!, call.line, call.guarded, true);
					continue;
				}
				const seen = idOf.get(k);
				if (seen !== undefined) {
					addEdge(id, seen, call.line, call.guarded, false);
					continue;
				}
				// Cut only what no path reaches within the limit.
				const td = depthOf(t);
				if (td > MAX_DEPTH) {
					stub(id, depth + 1, 'depth');
					continue;
				}
				if (counted >= MAX_NODES) {
					stub(id, depth + 1, 'nodes');
					continue;
				}
				const child = newFunctionNode(t, td);
				addEdge(id, child, call.line, call.guarded, false);
				onPath.add(k);
				visit(t, child, td, onPath);
				onPath.delete(k);
			}
		}
	};

	const root = newFunctionNode(start, 0);
	visit(start, root, 0, new Set([key(start)]));
	return { nodes, edges, truncated };
}

/** Per-endpoint numbers for the list: functions reached past the handler, and whether
 * a cap cut the trace short. */
export function summarize(flow: Flow | null): { steps: number; partial: boolean } {
	if (!flow) return { steps: 0, partial: false };
	return {
		steps: flow.nodes.filter((n) => n.kind === 'function').length - 1,
		partial: flow.truncated.depth + flow.truncated.nodes > 0
	};
}
