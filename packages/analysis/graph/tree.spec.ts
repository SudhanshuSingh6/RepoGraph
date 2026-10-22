import { describe, expect, it } from 'vitest';
import { derive } from './derive.ts';
import { buildTree, type TreeNode } from './tree.ts';
import type { FileNode, Graph } from './types.ts';

const file = (path: string, lang: FileNode['lang'], loc: number): FileNode => ({
	path,
	lang,
	loc,
	isTest: false,
	isEntry: false
});

const G: Graph = {
	files: [
		file('jobs/src/main/java/com/acme/A.java', 'java', 40),
		file('jobs/src/main/java/com/acme/B.java', 'java', 60),
		file('web/app.ts', 'ts', 30),
		file('web/util.js', 'js', 50),
		file('web/lib/x.ts', 'ts', 5),
		file('README.py', 'py', 7)
	],
	edges: [
		[0, 1],
		[1, 0],
		[2, 3],
		[4, 3]
	]
};

const names = (n: TreeNode) => n.children!.map((c) => c.name);

describe('buildTree', () => {
	const tree = buildTree(G, derive(G), 'repo');

	it('collapses single-child folder chains, folders first then files', () => {
		expect(tree.name).toBe('repo');
		expect(names(tree)).toEqual(['jobs/src/main/java/com/acme', 'web', 'README.py']);
		const acme = tree.children![0];
		expect(acme.path).toBe('jobs/src/main/java/com/acme');
		expect(names(acme)).toEqual(['A.java', 'B.java']);
	});

	it('keeps a folder whose only child is a file', () => {
		const web = tree.children![1];
		expect(names(web)).toEqual(['lib', 'app.ts', 'util.js']);
		expect(names(web.children![0])).toEqual(['x.ts']);
	});

	it('aggregates lines, files, fan-in/out and cycle files', () => {
		expect(tree).toMatchObject({ loc: 192, files: 6, maxFanIn: 2, maxFanOut: 1, cycleFiles: 2 });
		const web = tree.children![1];
		expect(web).toMatchObject({ loc: 85, files: 3, maxFanIn: 2, cycleFiles: 0 });
		expect(tree.children![0]).toMatchObject({ cycleFiles: 2, maxFanIn: 1 });
	});

	it('picks the dominant language by lines', () => {
		expect(tree.lang).toBe('java'); // 100 java vs 50 js, 35 ts, 7 py
		expect(tree.children![1].lang).toBe('js'); // 50 js vs 35 ts
		expect(tree.children![1].langLoc).toEqual({ ts: 35, js: 50 });
	});

	it('links file nodes back to their file index', () => {
		expect(tree.children![2]).toMatchObject({ file: 5, path: 'README.py', files: 1 });
	});

	it('only includes active files', () => {
		const d = derive(G, [true, true, false, false, false, true]);
		const t = buildTree(G, d);
		expect(names(t)).toEqual(['jobs/src/main/java/com/acme', 'README.py']);
		expect(t.loc).toBe(107);
	});
});
