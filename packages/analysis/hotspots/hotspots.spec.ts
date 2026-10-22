import { describe, expect, it } from 'vitest';
import { derive, type FileNode, type Lang } from '../graph/index.ts';
import { referencedTypes, type TypeDecl } from '../types/index.ts';
import { importCycles, possiblyUnused, ranked } from './hotspots.ts';

const LANG: Record<string, Lang> = { java: 'java', py: 'py', ts: 'ts', js: 'js' };

function repo(
	specs: (string | { path: string; loc?: number; isTest?: boolean; isEntry?: boolean })[],
	edges: [string, string][] = []
) {
	const files: FileNode[] = specs.map((s) => {
		const f = typeof s === 'string' ? { path: s } : s;
		return {
			path: f.path,
			lang: LANG[f.path.split('.').pop()!],
			loc: f.loc ?? 10,
			isTest: f.isTest ?? false,
			isEntry: f.isEntry ?? false
		};
	});
	const at = (p: string) => files.findIndex((f) => f.path === p);
	const graph = { files, edges: edges.map(([a, b]) => [at(a), at(b)] as [number, number]) };
	return { files, graph, at, derived: derive(graph) };
}

function decl(file: number, name: string, ext: string[] = [], impl: string[] = []): TypeDecl {
	return { file, name, kind: 'class', extends: ext, implements: impl, line: 1 };
}

/** possiblyUnused over the whole (unfiltered) repo, as paths. */
function unused(r: ReturnType<typeof repo>, types: TypeDecl[] = [], active?: boolean[]) {
	const derived = active ? derive(r.graph, active) : r.derived;
	const used = referencedTypes(types, r.files, r.derived.adj);
	return possiblyUnused(
		r.files,
		derived,
		types.map((t) => t.file),
		used
	).map((i) => r.files[i].path);
}

describe('ranked', () => {
	it('ranks active files by the metric, ties by path, leaving out zeros', () => {
		const r = repo([
			{ path: 'b.ts', loc: 5 },
			{ path: 'a.ts', loc: 5 },
			{ path: 'c.ts', loc: 9 },
			{ path: 'd.ts', loc: 0 },
			{ path: 'e.ts', loc: 50 }
		]);
		const loc = (i: number) => r.files[i].loc;
		expect(
			ranked(r.files, [true, true, true, true, false], loc).map((i) => r.files[i].path)
		).toEqual(['c.ts', 'a.ts', 'b.ts']);
		expect(ranked(r.files, [true, true, true, true, true], loc, 2)).toEqual([4, 2]);
	});
});

describe('importCycles', () => {
	it('lists each cycle largest first, members in path order', () => {
		const r = repo(
			['z.ts', 'y.ts', 'x.ts', 'q.ts', 'p.ts'],
			[
				['z.ts', 'y.ts'],
				['y.ts', 'x.ts'],
				['x.ts', 'z.ts'],
				['q.ts', 'p.ts'],
				['p.ts', 'q.ts']
			]
		);
		expect(importCycles(r.files, r.derived).map((c) => c.map((i) => r.files[i].path))).toEqual([
			['x.ts', 'y.ts', 'z.ts'],
			['p.ts', 'q.ts']
		]);
	});
});

describe('possiblyUnused', () => {
	it('never flags a base class only subclassed in its own package, with no import', () => {
		// BUILD_PLAN Phase 7 acceptance: the prototype's first pass listed Base here.
		const r = repo(['pkg/Base.java', 'pkg/Child.java']);
		const types = [decl(0, 'Base'), decl(1, 'Child', ['Base'])];
		expect(unused(r, types)).toEqual(['pkg/Child.java']);
		// An interface implemented the same way counts too.
		expect(unused(r, [decl(0, 'Base'), decl(1, 'Child', [], ['Base'])])).toEqual([
			'pkg/Child.java'
		]);
	});

	it('only counts a subclass in another file', () => {
		const r = repo(['pkg/Shapes.java']);
		expect(unused(r, [decl(0, 'Base'), decl(0, 'Child', ['Base'])])).toEqual(['pkg/Shapes.java']);
	});

	it('treats an ambiguous supertype name as referring to every candidate', () => {
		const r = repo(['a/Base.java', 'b/Base.java', 'c/Child.java']);
		const types = [decl(0, 'Base'), decl(1, 'Base'), decl(2, 'Child', ['Base'])];
		expect(unused(r, types)).toEqual(['c/Child.java']);
	});

	it("doesn't count a same-named supertype in another language", () => {
		const r = repo(['py/base.py', 'java/Child.java']);
		const types = [decl(0, 'Base'), decl(1, 'Child', ['Base'])];
		expect(unused(r, types)).toEqual(['java/Child.java', 'py/base.py']);
	});

	it('counts a subclass in a filtered-out file ("anywhere in the repo")', () => {
		const r = repo(['pkg/Base.java', { path: 'pkg/BaseTest.java', isTest: true }]);
		const types = [decl(0, 'Base'), decl(1, 'BaseTest', ['Base'])];
		expect(unused(r, types, [true, false])).toEqual([]);
	});

	it('leaves out imported files, tests, entry points and inactive files', () => {
		const r = repo(
			[
				'src/used.ts',
				'src/importer.ts',
				{ path: 'src/a.test.ts', isTest: true },
				{ path: 'src/index.ts', isEntry: true },
				'src/hidden.py',
				'src/orphan.ts'
			],
			[
				['src/importer.ts', 'src/used.ts'],
				['src/importer.ts', 'src/orphan.ts']
			]
		);
		// orphan is imported, so it's the importer that's unused; hidden.py is filtered out.
		expect(unused(r, [], [true, true, true, true, false, true])).toEqual(['src/importer.ts']);
	});

	it('sorts candidates by fan-out, then path', () => {
		const r = repo(
			['lib/x.ts', 'lib/y.ts', 'a.ts', 'b.ts', 'c.ts'],
			[
				['c.ts', 'lib/x.ts'],
				['c.ts', 'lib/y.ts'],
				['b.ts', 'lib/x.ts']
			]
		);
		expect(unused(r)).toEqual(['c.ts', 'b.ts', 'a.ts']);
	});
});
