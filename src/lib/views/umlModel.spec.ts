import { describe, expect, it } from 'vitest';
import { derive, type FileNode, type Graph } from '#analysis/graph/index.ts';
import { resolveSupertypes, type TypeDecl } from '#analysis/types/index.ts';
import { classDiagram, componentDiagram } from './umlModel.ts';

// The sample's Java jobs module: BaseJob (abstract) is extended by CleanupJob in its own
// package (no import) and by ReportJob from the `reports` sub-package (with an import).
const J = 'jobs/src/main/java/com/example/jobs/';
const paths = [J + 'BaseJob.java', J + 'CleanupJob.java', J + 'reports/ReportJob.java'];
const files: FileNode[] = paths.map((path) => ({
	path,
	lang: 'java',
	loc: 5,
	isTest: false,
	isEntry: false
}));
const graph: Graph = { files, edges: [[2, 0]] };
const d = derive(graph);
const types: TypeDecl[] = [
	{ file: 0, name: 'BaseJob', kind: 'abstract', extends: [], implements: [], line: 3 },
	{ file: 1, name: 'CleanupJob', kind: 'class', extends: ['BaseJob'], implements: [], line: 4 },
	{ file: 2, name: 'ReportJob', kind: 'class', extends: ['BaseJob'], implements: [], line: 6 }
];
const edges = resolveSupertypes(types, files, d.adj);
const all = [true, true, true];
const PKG = 'jobs/src/main/java/com/example/jobs';
const LEVEL = 8; // deep enough that `reports` is its own package

describe('componentDiagram', () => {
	it('keeps every group, connected or not', () => {
		const m = componentDiagram(files, d, LEVEL);
		expect(m.nodes.map((n) => n.id)).toEqual([PKG, PKG + '/reports']);
		expect(m.links.map((l) => [l.source, l.target])).toEqual([[PKG + '/reports', PKG]]);
	});
});

describe('classDiagram', () => {
	it('draws the same-package extends arrow (CleanupJob → BaseJob)', () => {
		const c = classDiagram(types, edges, files, all, LEVEL, PKG);
		expect(c.boxes).toEqual([
			{ type: 0, external: false },
			{ type: 1, external: false }
		]);
		expect(c.edges).toEqual([{ child: 1, parent: 0, kind: 'extends' }]);
	});

	it('shows a supertype from another package as a faded box', () => {
		const c = classDiagram(types, edges, files, all, LEVEL, PKG + '/reports');
		expect(c.boxes).toEqual([
			{ type: 2, external: false },
			{ type: 0, external: true }
		]);
		expect(c.edges).toEqual([{ child: 2, parent: 0, kind: 'extends' }]);
	});

	it('only uses active files', () => {
		const c = classDiagram(types, edges, files, [false, true, true], LEVEL, PKG);
		expect(c.boxes).toEqual([{ type: 1, external: false }]);
		expect(c.edges).toEqual([]);
	});
});
