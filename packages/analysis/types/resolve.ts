import type { FileNode, Lang } from '../graph/types.ts';
import type { EntityDecl, EntityEdge, TypeDecl, TypeEdge } from './types.ts';

/** JS and TS share one namespace (a .ts class can extend a .js one); the other
 * languages only ever reference their own. */
export function langFamily(lang: Lang): string {
	return lang === 'ts' ? 'js' : lang;
}

/** `a.b.Base<T>` → `Base`: references are matched by their simple name. */
export function simpleName(ref: string): string {
	const bare = ref.replace(/<.*$/s, '').replace(/\[.*$/s, '').trim();
	return bare.slice(bare.lastIndexOf('.') + 1);
}

function folderOf(path: string): string {
	return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

/**
 * Resolves names written in one file to declared items (types, entities) elsewhere in
 * the repo, only ever within the same `scope` — a language family, plus the ORM for
 * entities — so a name never matches an unrelated item that merely shares it.
 * Candidates, in order: the same file, the same folder, a file the referencing file
 * imports, then the only item with that name in scope. Anything else is external or
 * ambiguous, and resolves to null.
 */
export function nameResolver<T extends { file: number; name: string }>(
	items: T[],
	files: FileNode[],
	adj: number[][],
	scopeOf: (item: T) => string
) {
	const byKey = new Map<string, number[]>();
	items.forEach((item, i) => {
		const key = `${scopeOf(item)}\u0000${item.name}`;
		const list = byKey.get(key);
		if (list) list.push(i);
		else byKey.set(key, [i]);
	});
	return (fromFile: number, scope: string, ref: string, exclude?: number): number | null => {
		const candidates = (byKey.get(`${scope}\u0000${simpleName(ref)}`) ?? []).filter(
			(i) => i !== exclude
		);
		if (candidates.length === 0) return null;
		const dir = folderOf(files[fromFile].path);
		const imported = new Set(adj[fromFile]);
		const tiers: ((i: number) => boolean)[] = [
			(i) => items[i].file === fromFile,
			(i) => folderOf(files[items[i].file].path) === dir,
			(i) => imported.has(items[i].file)
		];
		for (const inTier of tiers) {
			const hit = candidates.find(inTier);
			if (hit !== undefined) return hit;
		}
		return candidates.length === 1 ? candidates[0] : null;
	};
}

/** Every `extends`/`implements` that names a declaration in the same repo and language. */
export function resolveSupertypes(
	types: TypeDecl[],
	files: FileNode[],
	adj: number[][]
): TypeEdge[] {
	const scopeOf = (t: TypeDecl) => langFamily(files[t.file].lang);
	const resolve = nameResolver(types, files, adj, scopeOf);
	const edges: TypeEdge[] = [];
	types.forEach((t, child) => {
		for (const kind of ['extends', 'implements'] as const) {
			for (const ref of t[kind]) {
				const parent = resolve(t.file, scopeOf(t), ref, child);
				if (parent !== null) edges.push({ child, parent, kind });
			}
		}
	});
	return edges;
}

/**
 * Every relationship whose target names an entity of the same ORM in the same language
 * — a SQLAlchemy `relationship("Order")` names a class in its own registry, never a JPA
 * `Order`. A relationship back to its own entity (Django's `'self'`) is an edge too.
 */
export function resolveRelations(
	entities: EntityDecl[],
	files: FileNode[],
	adj: number[][]
): EntityEdge[] {
	const scopeOf = (e: EntityDecl) => `${langFamily(files[e.file].lang)}:${e.orm}`;
	const resolve = nameResolver(entities, files, adj, scopeOf);
	const edges: EntityEdge[] = [];
	entities.forEach((e, from) => {
		for (const r of e.relations) {
			const to = resolve(e.file, scopeOf(e), r.target);
			if (to !== null) edges.push({ from, to, field: r.field, kind: r.kind });
		}
	});
	return edges;
}
