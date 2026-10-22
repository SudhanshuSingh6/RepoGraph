import { describe, expect, it } from 'vitest';
import { derive, type FileNode, type Graph, type Lang } from '../graph/index.ts';
import { resolveRelations, resolveSupertypes, simpleName } from './resolve.ts';
import type { EntityDecl, Orm, RelationKind, TypeDecl } from './types.ts';

const LANG: Record<string, Lang> = { java: 'java', py: 'py', ts: 'ts', js: 'js' };

function repo(paths: string[], edges: [string, string][] = []) {
	const files: FileNode[] = paths.map((path) => ({
		path,
		lang: LANG[path.split('.').pop()!],
		loc: 1,
		isTest: false,
		isEntry: false
	}));
	const graph: Graph = {
		files,
		edges: edges.map(([a, b]) => [paths.indexOf(a), paths.indexOf(b)])
	};
	return { files, adj: derive(graph).adj, at: (p: string) => paths.indexOf(p) };
}

function decl(file: number, name: string, ext: string[] = [], impl: string[] = []): TypeDecl {
	return { file, name, kind: 'class', extends: ext, implements: impl, line: 1 };
}

describe('simpleName', () => {
	it('drops qualification and type arguments', () => {
		expect(simpleName('a.b.Base<Map<K, V>>')).toBe('Base');
		expect(simpleName('models.Model')).toBe('Model');
		expect(simpleName('Generic[T]')).toBe('Generic');
	});
});

describe('resolveSupertypes', () => {
	it('links a subclass to a base class in the same package, with no import', () => {
		// The sample's CleanupJob extends BaseJob: same package, so no import exists.
		const r = repo(['jobs/BaseJob.java', 'jobs/CleanupJob.java']);
		const types = [decl(0, 'BaseJob'), decl(1, 'CleanupJob', ['BaseJob'])];
		expect(resolveSupertypes(types, r.files, r.adj)).toEqual([
			{ child: 1, parent: 0, kind: 'extends' }
		]);
	});

	it('records extends and implements separately, generics and qualification stripped', () => {
		const r = repo(['a/Base.java', 'a/Svc.java', 'a/Impl.java']);
		const types = [
			decl(0, 'Base'),
			decl(1, 'Svc'),
			decl(2, 'Impl', ['com.x.Base<String>'], ['Svc', 'java.io.Serializable'])
		];
		expect(resolveSupertypes(types, r.files, r.adj)).toEqual([
			{ child: 2, parent: 0, kind: 'extends' },
			{ child: 2, parent: 1, kind: 'implements' }
		]);
	});

	it('prefers the same file, then the same folder, then an imported file', () => {
		const r = repo(['x/a.ts', 'x/b.ts', 'y/c.ts', 'z/d.ts'], [['z/d.ts', 'y/c.ts']]);
		const types = [
			decl(0, 'Base'), // 0, x/a.ts
			decl(0, 'SameFile', ['Base']), // 1 → 0
			decl(1, 'SameFolder', ['Base']), // 2 → 0 (x/a.ts is in its folder)
			decl(2, 'Base'), // 3, y/c.ts
			decl(3, 'ViaImport', ['Base']) // 4 → 3 (z/d.ts imports y/c.ts)
		];
		expect(resolveSupertypes(types, r.files, r.adj)).toEqual([
			{ child: 1, parent: 0, kind: 'extends' },
			{ child: 2, parent: 0, kind: 'extends' },
			{ child: 4, parent: 3, kind: 'extends' }
		]);
	});

	it('falls back to the only declaration with that name, and gives up when ambiguous', () => {
		const unique = repo(['a/Base.py', 'b/sub.py']);
		expect(
			resolveSupertypes([decl(0, 'Base'), decl(1, 'Sub', ['Base'])], unique.files, unique.adj)
		).toEqual([{ child: 1, parent: 0, kind: 'extends' }]);

		const twice = repo(['a/m.py', 'b/m.py', 'c/sub.py']);
		const types = [decl(0, 'Base'), decl(1, 'Base'), decl(2, 'Sub', ['Base'])];
		expect(resolveSupertypes(types, twice.files, twice.adj)).toEqual([]);
	});

	it('never resolves across languages, but JS and TS share one namespace', () => {
		const r = repo(['a/Base.java', 'a/base.py', 'a/sub.py', 'w/base.js', 'w/sub.ts']);
		const types = [
			decl(0, 'Base'),
			decl(2, 'Sub', ['Base']), // a/base.py declares nothing: must not find the Java Base
			decl(3, 'Widget'),
			decl(4, 'Button', ['Widget'])
		];
		expect(resolveSupertypes(types, r.files, r.adj)).toEqual([
			{ child: 3, parent: 2, kind: 'extends' }
		]);
	});

	it('leaves library supertypes and self-named shadows unresolved', () => {
		const r = repo(['a/view.ts']);
		const types = [decl(0, 'Component', ['React.Component'])];
		expect(resolveSupertypes(types, r.files, r.adj)).toEqual([]);
	});
});

function entity(
	file: number,
	name: string,
	orm: Orm,
	relations: [string, RelationKind, string][] = []
): EntityDecl {
	return {
		file,
		name,
		table: name,
		orm,
		fields: [],
		relations: relations.map(([field, kind, target]) => ({ field, kind, target })),
		line: 1
	};
}

describe('resolveRelations', () => {
	it("doesn't link the sample's SQLAlchemy Customer to its JPA Order", () => {
		const r = repo(['backend/models.py', 'jobs/model/Order.java']);
		const entities = [
			entity(0, 'Customer', 'sqlalchemy', [['orders', 'RelatedTo', 'Order']]),
			entity(1, 'Order', 'jpa')
		];
		expect(resolveRelations(entities, r.files, r.adj)).toEqual([]);
	});

	it('links to a same-named entity of the same ORM, never another ORM or language', () => {
		const r = repo(['backend/models.py', 'shop/orders.py', 'jobs/Order.java', 'web/order.ts']);
		const entities = [
			entity(0, 'Customer', 'sqlalchemy', [['orders', 'RelatedTo', 'Order']]),
			entity(1, 'Order', 'django'), // same language, other ORM
			entity(2, 'Order', 'jpa'),
			entity(3, 'Order', 'typeorm'),
			entity(1, 'Order', 'sqlalchemy') // the only real match
		];
		expect(resolveRelations(entities, r.files, r.adj)).toEqual([
			{ from: 0, to: 4, field: 'orders', kind: 'RelatedTo' }
		]);
	});

	it('resolves qualified targets, self-references and leaves unknown ones unlinked', () => {
		const r = repo(['library/models.py', 'shop/models.py']);
		const entities = [
			entity(0, 'Book', 'django', [
				['tags', 'N–N', 'library.Tag'],
				['sequel', '1–1', 'Book'],
				['owner', 'N–1', 'auth.User']
			]),
			entity(0, 'Tag', 'django'),
			entity(1, 'Tag', 'django')
		];
		// Two Tags: the one in Book's own file wins.
		expect(resolveRelations(entities, r.files, r.adj)).toEqual([
			{ from: 0, to: 1, field: 'tags', kind: 'N–N' },
			{ from: 0, to: 0, field: 'sequel', kind: '1–1' }
		]);
	});

	it('treats JS and TS TypeORM entities as one namespace', () => {
		const r = repo(['src/user.ts', 'src/photo.js']);
		const entities = [
			entity(0, 'User', 'typeorm', [['photos', '1–N', 'Photo']]),
			entity(1, 'Photo', 'typeorm')
		];
		expect(resolveRelations(entities, r.files, r.adj)).toEqual([
			{ from: 0, to: 1, field: 'photos', kind: '1–N' }
		]);
	});
});
