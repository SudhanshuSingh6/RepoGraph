import { describe, expect, it } from 'vitest';
import { toFnChart } from './flowchart.ts';
import {
	OP_WORDS,
	callQueries,
	detectedQueries,
	opLabel,
	type Query,
	type QueryOp
} from './queries.ts';
import { traceEndpoint, type StoredCall, type StoredFunction } from './trace.ts';

const q = (op: QueryOp, target: string, over: Partial<Query> = {}): Query => ({
	kind: 'orm',
	orm: 'jpa',
	op,
	target,
	text: `${op} ${target}`,
	textLength: 10,
	truncated: false,
	executes: 'yes',
	...over
});

const fn = (name: string, calls: Partial<StoredCall>[] = [], over = {}): StoredFunction => ({
	name,
	owner: null,
	line: 1,
	end_line: 2,
	synthetic: false,
	abstract: false,
	...over,
	calls: calls.map((c) => ({
		receiver: null,
		name: 'c',
		line: 1,
		guarded: false,
		args: 0,
		new: false,
		...c
	}))
});

// A controller calling a repository method twice (once conditionally), an inline
// query, a fanout to two repositories, and a repository method nobody calls.
const functions = new Map<string, StoredFunction[]>([
	[
		'Ctl.java',
		[
			fn('handle', [
				{ name: 'findByName', line: 3, target: { path: 'Repo.java', fn: 0 } },
				{ name: 'findByName', line: 5, guarded: true, target: { path: 'Repo.java', fn: 0 } },
				{ name: 'save', line: 7, query: q('SAVE', 'Owner') },
				{
					name: 'load',
					line: 9,
					fanout: [
						{ path: 'Repo.java', fn: 0 },
						{ path: 'Repo.java', fn: 2 }
					]
				},
				{ name: 'helper', line: 11, target: { path: 'Ctl.java', fn: 1 } }
			]),
			fn('helper', [{ name: 'count', line: 20, query: q('SELECT', 'Pet') }])
		]
	],
	[
		'Repo.java',
		[
			fn('findByName', [], { owner: 'OwnerRepo', abstract: true, query: q('SELECT', 'Owner') }),
			fn('unused', [], { owner: 'OwnerRepo', abstract: true, query: q('DELETE', 'Owner') }),
			fn('findByName', [], { owner: 'VetRepo', abstract: true, query: q('SELECT', 'Vet') })
		]
	]
]);
const files = [
	{ path: 'Ctl.java', lang: 'java' },
	{ path: 'Repo.java', lang: 'java' }
] as Parameters<typeof toFnChart>[2];
const fileIndex = new Map([
	['Ctl.java', 0],
	['Repo.java', 1]
]);

describe('callQueries', () => {
	const calls = functions.get('Ctl.java')![0].calls;

	it("attaches a repository method's query at each call site, with that site's context", () => {
		const [first] = callQueries(calls[0], functions);
		const [second] = callQueries(calls[1], functions);
		expect(first).toMatchObject({ op: 'SELECT', target: 'Owner', line: 3, guarded: false });
		expect(first.viaRepository).toBe('OwnerRepo.findByName');
		expect(second).toMatchObject({ line: 5, guarded: true }); // conditional here only
	});

	it("keeps a call's own query", () => {
		expect(callQueries(calls[2], functions)).toMatchObject([
			{ op: 'SAVE', target: 'Owner', viaRepository: null, oneOf: null }
		]);
	});

	it('gives a fanout call one query per implementation, marked one of N', () => {
		const got = callQueries(calls[3], functions);
		expect(got.map((x) => [x.target, x.oneOf])).toEqual([
			['Owner', 2],
			['Vet', 2]
		]);
	});
});

describe('detectedQueries', () => {
	const flow = traceEndpoint({ path: 'Ctl.java', fn: 0 }, functions, fileIndex);

	it('lists every call-site query in trace order; an uncalled repository method adds none', () => {
		const { queries, partial } = detectedQueries(flow, functions);
		expect(queries.map((x) => [x.fn, x.line, x.target])).toEqual([
			['handle', 3, 'Owner'],
			['handle', 5, 'Owner'], // two call sites, two queries
			['handle', 7, 'Owner'],
			['handle', 9, 'Owner'],
			['handle', 9, 'Vet'],
			['helper', 20, 'Pet']
		]);
		expect(queries.some((x) => x.op === 'DELETE')).toBe(false);
		expect(partial).toBe(false);
	});

	it("matches the chart's badges for the same function", () => {
		const chart = toFnChart({ path: 'Ctl.java', fn: 0 }, functions, files, fileIndex)!;
		const badges = chart.calls.reduce((n, c) => n + c.queries.length, 0);
		const listed = detectedQueries(flow, functions).queries.filter((x) => x.fn === 'handle');
		expect(badges).toBe(listed.length);
	});

	it('says when the trace was cut short, so there may be more', () => {
		const cut = { nodes: [], edges: [], truncated: { depth: 1, nodes: 0 } };
		expect(detectedQueries(cut, functions).partial).toBe(true);
	});

	it('is empty without a flow', () => {
		expect(detectedQueries(null, functions)).toEqual({ queries: [], partial: false });
	});
});

describe('SAVE and UPSERT', () => {
	it('read differently: an ORM save is not a database upsert', () => {
		expect(opLabel('SAVE')).not.toBe(opLabel('UPSERT'));
		expect(OP_WORDS.SAVE).not.toBe(OP_WORDS.UPSERT);
		expect(OP_WORDS.SAVE).toContain('insert or update');
		expect(OP_WORDS.UPSERT).toContain('on conflict');
		expect(opLabel('UNKNOWN')).toBe('?');
	});
});
