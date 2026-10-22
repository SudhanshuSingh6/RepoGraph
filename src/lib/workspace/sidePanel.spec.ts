import { describe, expect, it } from 'vitest';
import { derive, type FileNode, type Lang } from '#analysis/graph/index.ts';
import type { EntityDecl } from '#analysis/types/index.ts';
import {
	entityDetails,
	fileDetails,
	folderDetails,
	languageShares,
	overview
} from './sidePanel.ts';

const LANG: Record<string, Lang> = { java: 'java', py: 'py', ts: 'ts', js: 'js' };

function repo(specs: [path: string, loc: number][], edges: [string, string][] = []) {
	const files: FileNode[] = specs.map(([path, loc]) => ({
		path,
		lang: LANG[path.split('.').pop()!],
		loc,
		isTest: false,
		isEntry: false
	}));
	const at = (p: string) => files.findIndex((f) => f.path === p);
	const graph = { files, edges: edges.map(([a, b]) => [at(a), at(b)] as [number, number]) };
	return { files, graph, at };
}

// web/a ⇄ web/b is a cycle; api/c.py imports nothing and nothing imports it.
const R = repo(
	[
		['web/a.ts', 10],
		['web/b.ts', 30],
		['web/sub/d.js', 5],
		['api/c.py', 50]
	],
	[
		['web/a.ts', 'web/b.ts'],
		['web/b.ts', 'web/a.ts'],
		['web/sub/d.js', 'web/b.ts']
	]
);

describe('languageShares', () => {
	it('totals files and lines per language, most lines first', () => {
		expect(languageShares(R.files, [0, 1, 2, 3])).toEqual([
			{ lang: 'py', files: 1, lines: 50 },
			{ lang: 'ts', files: 2, lines: 40 },
			{ lang: 'js', files: 1, lines: 5 }
		]);
	});
});

describe('overview', () => {
	it('summarises the active files only', () => {
		const all = overview(R.files, derive(R.graph), 2);
		expect(all).toMatchObject({ files: 4, lines: 95, imports: 3, cycles: 1, unused: 2 });
		expect(all.largest).toBe(R.at('api/c.py'));
		expect(all.mostImported).toBe(R.at('web/b.ts'));

		const noPy = overview(R.files, derive(R.graph, [true, true, true, false]), null);
		expect(noPy).toMatchObject({ files: 3, lines: 45, imports: 3, unused: null });
		expect(noPy.largest).toBe(R.at('web/b.ts'));
	});

	it('has no most-imported file when nothing imports anything', () => {
		const r = repo([['a.ts', 1]]);
		expect(overview(r.files, derive(r.graph), 0).mostImported).toBeNull();
	});
});

describe('fileDetails', () => {
	it('lists imports and importers in path order, with the cycle flag', () => {
		const d = fileDetails(R.at('web/b.ts'), R.files, derive(R.graph), derive(R.graph));
		expect(d).toMatchObject({ hidden: false, fanIn: 2, fanOut: 1, inCycle: true });
		expect(d.imports).toEqual([R.at('web/a.ts')]);
		expect(d.importedBy).toEqual([R.at('web/a.ts'), R.at('web/sub/d.js')]);
	});

	it('falls back to the whole repo when the filters hide the file', () => {
		const filtered = derive(R.graph, [true, true, false, true]);
		const d = fileDetails(R.at('web/sub/d.js'), R.files, filtered, derive(R.graph));
		expect(d).toMatchObject({ hidden: true, fanOut: 1, imports: [R.at('web/b.ts')] });
		// …while a visible file's importers leave the hidden one out.
		expect(fileDetails(R.at('web/b.ts'), R.files, filtered, derive(R.graph)).importedBy).toEqual([
			R.at('web/a.ts')
		]);
	});
});

describe('folderDetails', () => {
	it('covers the subtree, largest file first, without matching a sibling prefix', () => {
		const r = repo([
			['web/a.ts', 10],
			['web/sub/d.js', 5],
			['webapp/x.ts', 99],
			['web/b.ts', 30]
		]);
		const d = folderDetails('web', r.files, [true, true, true, true]);
		expect(d.files.map((i) => r.files[i].path)).toEqual(['web/b.ts', 'web/a.ts', 'web/sub/d.js']);
		expect(d.lines).toBe(45);
		expect(folderDetails('web', r.files, [true, false, true, true]).files).toHaveLength(2);
	});
});

describe('entityDetails', () => {
	it('pairs each relationship with the entity it resolved to', () => {
		const entity = (name: string, relations: EntityDecl['relations'] = []): EntityDecl => ({
			file: 0,
			name,
			table: name.toLowerCase(),
			orm: 'django',
			fields: [],
			relations,
			line: 1
		});
		const entities = [
			entity('Book', [
				{ field: 'author', kind: 'N–1', target: 'Author' },
				{ field: 'owner', kind: 'N–1', target: 'auth.User' }
			]),
			entity('Author')
		];
		const edges = [{ from: 0, to: 1, field: 'author', kind: 'N–1' as const }];
		expect(entityDetails(0, entities, edges).relations.map((r) => r.to)).toEqual([1, null]);
	});
});
