import { describe, expect, it } from 'vitest';
import {
	MAX_DEPTH,
	MAX_NODES,
	layerOf,
	summarize,
	traceEndpoint,
	type FlowNode,
	type StoredCall,
	type StoredFunction
} from './trace.ts';

/** A call in test shorthand: `target`/`fanout` as 'path#index'. */
type CallSpec = Omit<Partial<StoredCall>, 'target' | 'fanout'> & {
	target?: string;
	fanout?: string[];
};
type Fn = Omit<Partial<StoredFunction>, 'calls'> & { name: string; calls?: CallSpec[] };

/** {path: functions} → the maps traceEndpoint takes. */
function repo(spec: Record<string, Fn[]>) {
	const ref = (s: string) => {
		const [path, fn] = s.split('#');
		return { path, fn: Number(fn) };
	};
	const functions = new Map<string, StoredFunction[]>();
	for (const [path, fns] of Object.entries(spec)) {
		functions.set(
			path,
			fns.map((f): StoredFunction => ({
				owner: null,
				line: 1,
				end_line: 2,
				synthetic: false,
				abstract: false,
				...f,
				calls: (f.calls ?? []).map(({ target, fanout, ...c }): StoredCall => ({
					receiver: null,
					line: 1,
					guarded: false,
					args: 0,
					new: false,
					...c,
					name: c.name ?? 'x',
					...(target ? { target: ref(target) } : {}),
					...(fanout ? { fanout: fanout.map(ref) } : {})
				}))
			}))
		);
	}
	const fileIndex = new Map([...functions.keys()].map((p, i) => [p, i]));
	return { functions, fileIndex };
}

const call = (target: string, extra: Omit<CallSpec, 'target'> = {}): CallSpec => ({
	name: 'c',
	target,
	...extra
});
const fnNodes = (nodes: FlowNode[]) =>
	nodes.filter((n): n is Extract<FlowNode, { kind: 'function' }> => n.kind === 'function');

describe('traceEndpoint', () => {
	it('follows resolved calls across files and counts untraced ones on their node', () => {
		const r = repo({
			'ctl.ts': [
				{
					name: 'list',
					owner: 'OrderController',
					calls: [
						call('svc.ts#0', { line: 4 }),
						{ name: 'json', receiver: 'res', untraced: 'untyped', line: 5 },
						{ name: 'log', receiver: 'console', untraced: 'global', line: 6 },
						call('svc.ts#0', { line: 7, guarded: true })
					]
				}
			],
			'svc.ts': [
				{ name: 'all', owner: 'OrderService', calls: [call('repo.ts#0', { guarded: true })] }
			],
			'repo.ts': [{ name: 'find', owner: 'OrderRepository', abstract: true }]
		});
		const flow = traceEndpoint({ path: 'ctl.ts', fn: 0 }, r.functions, r.fileIndex)!;
		expect(fnNodes(flow.nodes).map((n) => [n.label, n.layer, n.depth])).toEqual([
			['OrderController.list', 'handler', 0],
			['OrderService.all', 'service', 1],
			['OrderRepository.find', 'repository', 2]
		]);
		expect(flow.edges).toEqual([
			{ from: 0, to: 1, lines: [4, 7], conditional: false, back: false }, // one unguarded call
			{ from: 1, to: 2, lines: [1], conditional: true, back: false }
		]);
		const root = fnNodes(flow.nodes)[0];
		expect(root.untraced).toEqual({ untyped: 1, global: 1 });
		expect(root.untracedCalls).toEqual([
			{ name: 'res.json', reason: 'untyped', line: 5 },
			{ name: 'console.log', reason: 'global', line: 6 }
		]);
		expect(fnNodes(flow.nodes)[2].abstract).toBe(true);
		expect(flow.truncated).toEqual({ depth: 0, nodes: 0 });
	});

	it('draws a cycle as a back-edge and reuses a node reached twice', () => {
		const r = repo({
			'a.ts': [
				{ name: 'h', calls: [call('a.ts#1'), call('a.ts#2')] },
				{ name: 'p', calls: [call('a.ts#2')] },
				{ name: 'q', calls: [call('a.ts#1'), call('a.ts#2')] }
			]
		});
		const flow = traceEndpoint({ path: 'a.ts', fn: 0 }, r.functions, r.fileIndex)!;
		expect(fnNodes(flow.nodes).map((n) => n.label)).toEqual(['h', 'p', 'q']);
		expect(flow.edges.map((e) => [e.from, e.to, e.back])).toEqual([
			[0, 1, false],
			[1, 2, false],
			[2, 1, true], // q → p while p is on the path
			[2, 2, true], // q → itself
			[0, 2, false] // h → q: already drawn, not expanded again
		]);
	});

	it('stops at the depth cap with a "…more" stub and counts what it cut', () => {
		const chain: Fn[] = Array.from({ length: MAX_DEPTH + 3 }, (_, i) => ({
			name: `f${i}`,
			calls: i < MAX_DEPTH + 2 ? [call(`a.ts#${i + 1}`)] : []
		}));
		const flow = traceEndpoint(
			{ path: 'a.ts', fn: 0 },
			repo({ 'a.ts': chain }).functions,
			new Map([['a.ts', 0]])
		)!;
		expect(fnNodes(flow.nodes)).toHaveLength(MAX_DEPTH + 1);
		expect(flow.truncated).toEqual({ depth: 1, nodes: 0 });
		const stub = flow.nodes.find((n) => n.kind === 'more')!;
		expect(stub).toMatchObject({ depth: MAX_DEPTH + 1, calls: 1, limit: 'depth' });
		expect(summarize(flow)).toEqual({ steps: MAX_DEPTH, partial: true });
	});

	it('places a function at its shortest depth even when the walk finds a longer path first', () => {
		// h → a → b → c → d → X → Y, and also h → X directly (called after a).
		const r = repo({
			'a.ts': [
				{ name: 'h', calls: [call('a.ts#1'), call('a.ts#5', { line: 9 })] },
				{ name: 'a', calls: [call('a.ts#2')] },
				{ name: 'b', calls: [call('a.ts#3')] },
				{ name: 'c', calls: [call('a.ts#4')] },
				{ name: 'd', calls: [call('a.ts#5')] },
				{ name: 'X', calls: [call('a.ts#6')] },
				{ name: 'Y' }
			]
		});
		const flow = traceEndpoint({ path: 'a.ts', fn: 0 }, r.functions, r.fileIndex)!;
		const byLabel = new Map(fnNodes(flow.nodes).map((n) => [n.label, n]));
		expect(byLabel.get('X')!.depth).toBe(1);
		expect(byLabel.get('Y')!.depth).toBe(2); // not cut by the 5-level limit
		expect(flow.truncated).toEqual({ depth: 0, nodes: 0 });
		expect(summarize(flow)).toEqual({ steps: 6, partial: false });
		const d = byLabel.get('d')!.id;
		const x = byLabel.get('X')!.id;
		expect(flow.edges.find((e) => e.from === d && e.to === x)).toMatchObject({ back: false });
		expect(flow.edges.find((e) => e.from === 0 && e.to === x)).toMatchObject({ lines: [9] });
	});

	it('gives the shorter of two paths whichever the walk takes first', () => {
		const paths = (directFirst: boolean) => {
			const direct = call('a.ts#3');
			const viaP = call('a.ts#1');
			return repo({
				'a.ts': [
					{ name: 'h', calls: directFirst ? [direct, viaP] : [viaP, direct] },
					{ name: 'p', calls: [call('a.ts#2')] },
					{ name: 'q', calls: [call('a.ts#3')] },
					{ name: 't' }
				]
			});
		};
		for (const directFirst of [true, false]) {
			const r = paths(directFirst);
			const flow = traceEndpoint({ path: 'a.ts', fn: 0 }, r.functions, r.fileIndex)!;
			expect(fnNodes(flow.nodes).find((n) => n.label === 't')!.depth).toBe(1);
		}
	});

	it('stops at the node cap', () => {
		const wide: Fn[] = [
			{ name: 'h', calls: Array.from({ length: MAX_NODES + 5 }, (_, i) => call(`a.ts#${i + 1}`)) },
			...Array.from({ length: MAX_NODES + 5 }, (_, i) => ({ name: `g${i}` }))
		];
		const flow = traceEndpoint(
			{ path: 'a.ts', fn: 0 },
			repo({ 'a.ts': wide }).functions,
			new Map([['a.ts', 0]])
		)!;
		expect(fnNodes(flow.nodes)).toHaveLength(MAX_NODES);
		expect(flow.truncated).toEqual({ depth: 0, nodes: 6 });
		expect(flow.nodes.filter((n) => n.kind === 'more')).toHaveLength(1);
	});

	it('fans out to implementations, and collapses many into one node', () => {
		const r = repo({
			'a.ts': [
				{
					name: 'h',
					calls: [
						{ name: 'send', fanout: ['b.ts#0', 'c.ts#0'] },
						{ name: 'pay', implementations: { path: 'a.ts', type: 'Gateway', count: 7 } }
					]
				}
			],
			'b.ts': [{ name: 'send', owner: 'SmtpMailer' }],
			'c.ts': [{ name: 'send', owner: 'SesMailer' }]
		});
		const flow = traceEndpoint({ path: 'a.ts', fn: 0 }, r.functions, r.fileIndex)!;
		expect(flow.nodes.map((n) => (n.kind === 'function' ? n.label : n.kind))).toEqual([
			'h',
			'SmtpMailer.send',
			'SesMailer.send',
			'implementations'
		]);
		expect(flow.nodes[3]).toMatchObject({ type: 'Gateway', count: 7, depth: 1 });
	});

	it('is null for a handler that is not stored', () => {
		expect(traceEndpoint({ path: 'x.ts', fn: 0 }, new Map(), new Map())).toBeNull();
		expect(summarize(null)).toEqual({ steps: 0, partial: false });
	});
});

describe('layerOf', () => {
	it('reads the class suffix, then the folder', () => {
		expect(layerOf('OwnerController', 'x.java')).toBe('controller');
		expect(layerOf('ArticleService', 'x.ts')).toBe('service');
		expect(layerOf('OwnerRepository', 'x.java')).toBe('repository');
		expect(layerOf(null, 'app/services/mail.py')).toBe('service');
		expect(layerOf(null, 'src/app/routes/article/article.service.ts')).toBe('service');
		expect(layerOf(null, 'src/app/routes/article/handlers.ts')).toBe('controller');
		expect(layerOf('Owner', 'model/Owner.java')).toBe('other');
	});
});
