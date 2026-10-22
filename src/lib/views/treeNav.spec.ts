import { describe, expect, it } from 'vitest';
import { buildTree, derive, type Graph } from '#analysis/graph/index.ts';
import { ancestry, findNode, folderPaths, searchHits } from './treeNav.ts';

const graph: Graph = {
	files: [
		{ path: 'src/main/java/App.java', lang: 'java', loc: 10, isTest: false, isEntry: false },
		{ path: 'web/src/state/store.ts', lang: 'ts', loc: 5, isTest: false, isEntry: false },
		{ path: 'web/src/ui/render.ts', lang: 'ts', loc: 5, isTest: false, isEntry: false },
		{ path: 'setup.py', lang: 'py', loc: 3, isTest: false, isEntry: false }
	],
	edges: []
};
const tree = buildTree(graph, derive(graph), 'repo');

describe('ancestry / findNode', () => {
	it('walks from the root to a node, through collapsed chains', () => {
		expect(ancestry(tree, 'web/src/ui')?.map((n) => n.name)).toEqual(['repo', 'web/src', 'ui']);
		expect(ancestry(tree, 'src/main/java/App.java')?.map((n) => n.name)).toEqual([
			'repo',
			'src/main/java',
			'App.java'
		]);
		expect(ancestry(tree, '')).toEqual([tree]);
	});

	it('returns null for a path no node has', () => {
		expect(ancestry(tree, 'web')).toBeNull(); // merged into `web/src`
		expect(findNode(tree, 'nope/x.ts')).toBeNull();
		expect(findNode(tree, 'setup.py')?.file).toBe(3);
	});
});

describe('folderPaths', () => {
	it('lists every folder, the root included', () => {
		expect(folderPaths(tree).sort()).toEqual(
			['', 'src/main/java', 'web/src', 'web/src/state', 'web/src/ui'].sort()
		);
	});
});

describe('searchHits', () => {
	it('is null for an empty search', () => {
		expect(searchHits(tree, graph.files, ' ')).toBeNull();
	});

	it('includes matching files and every folder above them', () => {
		expect([...searchHits(tree, graph.files, 'STORE')!].sort()).toEqual(
			['', 'web/src', 'web/src/state', 'web/src/state/store.ts'].sort()
		);
	});

	it('matches a folder name through its files’ paths', () => {
		expect(searchHits(tree, graph.files, 'ui/')!.has('web/src/ui/render.ts')).toBe(true);
	});
});
