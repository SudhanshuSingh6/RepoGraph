import type { Derived, FileNode, Lang } from '#analysis/graph/index.ts';
import type { EntityDecl, EntityEdge } from '#analysis/types/index.ts';

// repograph-spec.md §16: what the side panel shows for each selection state, as plain
// data. Everything is over the active (filtered) files, like the views.

export type LangShare = { lang: Lang; files: number; lines: number };

const byPath = (files: FileNode[]) => (a: number, b: number) =>
	files[a].path < files[b].path ? -1 : files[a].path > files[b].path ? 1 : 0;

/** Files and lines per language, most lines first. */
export function languageShares(files: FileNode[], indexes: number[]): LangShare[] {
	const by = new Map<Lang, LangShare>();
	for (const i of indexes) {
		const f = files[i];
		const s = by.get(f.lang) ?? { lang: f.lang, files: 0, lines: 0 };
		s.files++;
		s.lines += f.loc;
		by.set(f.lang, s);
	}
	return [...by.values()].sort((a, b) => b.lines - a.lines || a.lang.localeCompare(b.lang));
}

const sum = (files: FileNode[], indexes: number[]) => indexes.reduce((n, i) => n + files[i].loc, 0);

/** The no-selection overview. `unused` is null until the type data has loaded. */
export function overview(files: FileNode[], derived: Derived, unused: number | null) {
	const shown = files.flatMap((_, i) => (derived.active[i] ? [i] : []));
	const top = (metric: (i: number) => number) => {
		let best: number | null = null;
		for (const i of shown) {
			if (metric(i) > 0 && (best === null || metric(i) > metric(best))) best = i;
		}
		return best;
	};
	return {
		files: shown.length,
		lines: sum(files, shown),
		imports: derived.fanOut.reduce((n, k) => n + k, 0),
		cycles: derived.cycles.length,
		unused,
		languages: languageShares(files, shown),
		largest: top((i) => files[i].loc),
		mostImported: top((i) => derived.fanIn[i])
	};
}

/** A selected file. Its import lists come from the filtered graph, or from the whole
 * repo (`full`) when the filters hide the file itself. */
export function fileDetails(i: number, files: FileNode[], derived: Derived, full: Derived) {
	const hidden = !derived.active[i];
	const d = hidden ? full : derived;
	const order = byPath(files);
	return {
		file: files[i],
		hidden,
		fanIn: d.fanIn[i],
		fanOut: d.fanOut[i],
		inCycle: d.inCycle[i],
		imports: [...d.adj[i]].sort(order),
		importedBy: [...d.rev[i]].sort(order)
	};
}

/** A selected folder or package: its active files, largest first. */
export function folderDetails(folder: string, files: FileNode[], active: boolean[]) {
	const prefix = `${folder}/`;
	const inside = files
		.flatMap((f, i) => (active[i] && f.path.startsWith(prefix) ? [i] : []))
		.sort((a, b) => files[b].loc - files[a].loc || byPath(files)(a, b));
	return {
		folder,
		files: inside,
		lines: sum(files, inside),
		languages: languageShares(files, inside)
	};
}

/** A selected entity, each relationship with the entity it resolved to (or null). */
export function entityDetails(i: number, entities: EntityDecl[], edges: EntityEdge[]) {
	const e = entities[i];
	return {
		entity: e,
		relations: e.relations.map((r) => ({
			...r,
			to: edges.find((x) => x.from === i && x.field === r.field)?.to ?? null
		}))
	};
}
