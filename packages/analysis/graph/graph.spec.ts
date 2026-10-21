import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, bfsReach, derive, tarjan } from './index.ts';
import type { FileNode, Graph, Lang } from './types.ts';

function graphOf(paths: string[], edges: [string, string][], loc = 10): Graph {
	const lang = (p: string): Lang =>
		p.endsWith('.py') ? 'py' : p.endsWith('.java') ? 'java' : p.endsWith('.js') ? 'js' : 'ts';
	const files: FileNode[] = paths.map((path) => ({ path, lang: lang(path), loc, isTest: false }));
	const at = (p: string) => paths.indexOf(p);
	return { files, edges: edges.map(([a, b]) => [at(a), at(b)]) };
}

// The BUILD_PLAN Phase 4 acceptance fixture: a known 3-file cycle a → b → c → a, plus
// main → a, main → util, b → util, c → util and an isolated file.
const PATHS = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/main.ts', 'src/util.ts', 'src/lone.ts'];
const FIXTURE = graphOf(PATHS, [
	['src/a.ts', 'src/b.ts'],
	['src/b.ts', 'src/c.ts'],
	['src/c.ts', 'src/a.ts'],
	['src/main.ts', 'src/a.ts'],
	['src/main.ts', 'src/util.ts'],
	['src/b.ts', 'src/util.ts'],
	['src/c.ts', 'src/util.ts']
]);

describe('derive + tarjan on the known 3-file cycle', () => {
	const d = derive(FIXTURE);

	it('finds exactly the one cycle group', () => {
		expect(d.cycles).toEqual([[0, 1, 2]]);
		expect(d.inCycle).toEqual([true, true, true, false, false, false]);
	});

	it('counts fan-in and fan-out exactly', () => {
		//                     a  b  c  main util lone
		expect(d.fanIn).toEqual([2, 1, 1, 0, 3, 0]);
		expect(d.fanOut).toEqual([1, 2, 2, 2, 0, 0]);
		expect(d.adj[3]).toEqual([0, 4]);
		expect(d.rev[4]).toEqual([3, 1, 2]);
	});
});

describe('tarjan', () => {
	it('sorts cycle groups largest first', () => {
		// 0↔1 (size 2) and 2→3→4→2 (size 3)
		expect(tarjan([[1], [0], [3], [4], [2]])).toEqual([
			[2, 3, 4],
			[0, 1]
		]);
	});

	it('reports nothing for a DAG', () => {
		expect(tarjan([[1, 2], [2], [], [0]])).toEqual([]);
	});

	it('handles nested cycles as one SCC', () => {
		// 0→1→2→0 and 2→3→1: all four strongly connected
		expect(tarjan([[1], [2], [0, 3], [1]])).toEqual([[0, 1, 2, 3]]);
	});

	it('is iterative: a 200k-file import chain does not overflow the stack', () => {
		const n = 200_000;
		const adj = Array.from({ length: n }, (_, i) => (i + 1 < n ? [i + 1] : [0]));
		const cycles = tarjan(adj);
		expect(cycles).toHaveLength(1);
		expect(cycles[0]).toHaveLength(n);
	});
});

describe('derive with an active mask', () => {
	it('drops edges touching inactive files, which can break a cycle', () => {
		const d = derive(FIXTURE, [true, false, true, true, true, true]);
		expect(d.cycles).toEqual([]);
		expect(d.fanIn).toEqual([2, 0, 0, 0, 2, 0]);
	});

	it('ignores self-edges and duplicate edges', () => {
		const d = derive(
			graphOf(
				['a.ts', 'b.ts'],
				[
					['a.ts', 'a.ts'],
					['a.ts', 'b.ts'],
					['a.ts', 'b.ts']
				]
			)
		);
		expect(d.fanOut).toEqual([1, 0]);
		expect(d.cycles).toEqual([]);
	});
});

describe('bfsReach', () => {
	const d = derive(FIXTURE);

	it('forward: everything main depends on, transitively', () => {
		expect([...bfsReach(d.adj, 3)].sort()).toEqual([0, 1, 2, 4]);
	});

	it('reverse: everything a change to util can affect', () => {
		expect([...bfsReach(d.rev, 4)].sort()).toEqual([0, 1, 2, 3]);
	});

	it('includes the start only when it sits on a cycle', () => {
		expect(bfsReach(d.adj, 0).has(0)).toBe(true);
		expect(bfsReach(d.adj, 3).has(3)).toBe(false);
		expect(bfsReach(d.adj, 5).size).toBe(0);
	});

	it("multi-source: the union of every start node's reach", () => {
		expect([...bfsReach(d.rev, [4, 5])].sort()).toEqual([0, 1, 2, 3]);
		expect([...bfsReach(d.adj, [3, 5])].sort()).toEqual([0, 1, 2, 4]);
		expect(bfsReach(d.adj, []).size).toBe(0);
	});
});

describe('the sample project', () => {
	const root = new URL('../../../fixtures/sample-project/', import.meta.url);
	const paths = (readdirSync(root, { recursive: true }) as string[])
		.map((p) => p.split('\\').join('/'))
		.filter((p) => /\.(ts|js|py|java)$/.test(p))
		.sort();
	const known = JSON.parse(
		readFileSync(new URL('../../../tests/fixtures/sample-edges.json', import.meta.url), 'utf8')
	).edges as [string, string][];
	const g = graphOf(paths, known);
	const { derived } = analyze(g);

	it('has its one known cycle: store → render → format → store', () => {
		expect(paths).toHaveLength(17);
		expect(derived.cycles.map((c) => c.map((i) => paths[i]).sort())).toEqual([
			['web/src/state/store.ts', 'web/src/ui/format.js', 'web/src/ui/render.ts']
		]);
	});

	it('has the known fan-in', () => {
		const fanIn = (p: string) => derived.fanIn[paths.indexOf(p)];
		expect(fanIn('web/src/state/store.ts')).toBe(4);
		expect(fanIn('jobs/src/main/java/com/example/jobs/reports/ReportJob.java')).toBe(2);
		expect(fanIn('web/src/index.ts')).toBe(0);
	});
});
