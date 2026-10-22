import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNGROUPED, derive, type FileNode, type Graph } from '#analysis/graph/index.ts';
import { blastGroups, buildGraphModel } from './graphModel.ts';

function graphOf(paths: string[], edges: [string, string][]): Graph {
	const files: FileNode[] = paths.map((path) => ({
		path,
		lang: path.endsWith('.py') ? 'py' : 'ts',
		loc: 10,
		isTest: false,
		isEntry: false
	}));
	return { files, edges: edges.map(([a, b]) => [paths.indexOf(a), paths.indexOf(b)]) };
}

const ALL = { hideUnconnected: false, onlyCycles: false };

describe('buildGraphModel', () => {
	const g = graphOf(
		['a/x.ts', 'a/y.ts', 'b/z.ts', 'b/w.ts', 'c/v.py', 'lone.ts'],
		[
			['a/x.ts', 'b/z.ts'],
			['a/y.ts', 'b/z.ts'],
			['b/z.ts', 'a/x.ts'], // a/x ⇄ b/z is a cycle
			['b/w.ts', 'c/v.py'] // crosses folders but is no cycle
		]
	);
	const d = derive(g);

	it('ungrouped: one node per active file, one link per import', () => {
		const m = buildGraphModel(g.files, d, UNGROUPED, ALL);
		expect(m.nodes.map((n) => n.id)).toEqual(g.files.map((f) => f.path));
		expect(m.nodes[0]).toMatchObject({ label: 'x.ts', cluster: 'a', inCycle: true });
		expect(m.links).toHaveLength(4);
		expect(m.links.filter((l) => l.cycle).map((l) => [l.source, l.target])).toEqual([
			['a/x.ts', 'b/z.ts'],
			['b/z.ts', 'a/x.ts']
		]);
	});

	it('grouped: merges file imports into one arrow per folder pair', () => {
		const m = buildGraphModel(g.files, d, 1, ALL);
		expect(m.nodes.map((n) => [n.id, n.files.length, n.loc])).toEqual([
			['a', 2, 20],
			['b', 2, 20],
			['c', 1, 10],
			['lone.ts', 1, 10] // a root-level file stays its own node
		]);
		const ab = m.links.find((l) => l.source === 'a' && l.target === 'b')!;
		expect(ab).toMatchObject({ count: 2, cycle: true });
		expect(m.links.find((l) => l.source === 'b' && l.target === 'c')).toMatchObject({
			count: 1,
			cycle: false
		});
	});

	it('hide unconnected drops isolated nodes; only cycles keeps cycle nodes and arrows', () => {
		const hidden = buildGraphModel(g.files, d, UNGROUPED, { ...ALL, hideUnconnected: true });
		expect(hidden.nodes.map((n) => n.id)).not.toContain('lone.ts');
		const cycles = buildGraphModel(g.files, d, UNGROUPED, {
			hideUnconnected: true,
			onlyCycles: true
		});
		expect(cycles.nodes.map((n) => n.id)).toEqual(['a/x.ts', 'b/z.ts']);
		expect(cycles.links.every((l) => l.cycle)).toBe(true);
	});

	it('respects the active mask', () => {
		const masked = derive(g, [true, true, true, true, false, true]);
		const m = buildGraphModel(g.files, masked, UNGROUPED, ALL);
		expect(m.nodes.map((n) => n.id)).not.toContain('c/v.py');
		expect(m.links.some((l) => l.target === 'c/v.py')).toBe(false);
	});
});

describe('blastGroups', () => {
	it('follows real file import chains, not merged folder arrows', () => {
		// a/x → b/y and b/z → c/w: folder arrows read a → b → c, but nothing in `a`
		// imports b/z, so a change to `c` can only affect `b`.
		const g = graphOf(
			['a/x.ts', 'b/y.ts', 'b/z.ts', 'c/w.ts'],
			[
				['a/x.ts', 'b/y.ts'],
				['b/z.ts', 'c/w.ts']
			]
		);
		const d = derive(g);
		const m = buildGraphModel(g.files, d, 1, ALL);
		expect(m.links.map((l) => [l.source, l.target])).toEqual([
			['a', 'b'],
			['b', 'c']
		]);
		expect([...blastGroups(m, g.files, d, 'c')]).toEqual(['b']);
		expect([...blastGroups(m, g.files, d, 'b')]).toEqual(['a']);
		expect(blastGroups(m, g.files, d, 'a').size).toBe(0);
	});

	it('starts from every member file of a group', () => {
		const g = graphOf(
			['a/x.ts', 'a/y.ts', 'b/p.ts', 'c/q.ts'],
			[
				['b/p.ts', 'a/x.ts'],
				['c/q.ts', 'a/y.ts']
			]
		);
		const d = derive(g);
		const m = buildGraphModel(g.files, d, 1, ALL);
		expect([...blastGroups(m, g.files, d, 'a')].sort()).toEqual(['b', 'c']);
	});
});

describe('the sample project', () => {
	const edges = JSON.parse(
		readFileSync(new URL('../../../tests/fixtures/sample-edges.json', import.meta.url), 'utf8')
	).edges as [string, string][];
	const paths = [...new Set(edges.flat())];

	it('shows the store → format → render cycle in magenta', () => {
		const g = graphOf(paths, edges);
		const d = derive(g);
		const m = buildGraphModel(g.files, d, UNGROUPED, { hideUnconnected: true, onlyCycles: true });
		expect(m.nodes.map((n) => n.id).sort()).toEqual([
			'web/src/state/store.ts',
			'web/src/ui/format.js',
			'web/src/ui/render.ts'
		]);
	});
});
