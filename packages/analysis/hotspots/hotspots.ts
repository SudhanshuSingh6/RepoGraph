import type { Derived, FileNode } from '../graph/types.ts';

export const TOP = 12; // rows per ranked card (repograph-spec.md §13)

const byPath = (files: FileNode[]) => (a: number, b: number) =>
	files[a].path < files[b].path ? -1 : files[a].path > files[b].path ? 1 : 0;

/** Active files ranked by `metric`, highest first (ties by path). Files scoring 0 are
 * left out, so a small repo's "Most imported" isn't padded with files nothing imports. */
export function ranked(
	files: FileNode[],
	active: boolean[],
	metric: (i: number) => number,
	n = TOP
): number[] {
	const order = byPath(files);
	return files
		.flatMap((_, i) => (active[i] && metric(i) > 0 ? [i] : []))
		.sort((a, b) => metric(b) - metric(a) || order(a, b))
		.slice(0, n);
}

/** Every import cycle (SCC with >1 member) in the filtered graph, largest first, each
 * one's members in path order. */
export function importCycles(files: FileNode[], derived: Derived): number[][] {
	return derived.cycles.map((c) => [...c].sort(byPath(files)));
}

/**
 * "Possibly unused" (§14): active files nothing imports, that aren't tests or entry
 * points, and that declare no type a declaration in another file extends or implements
 * (`referenced`, from `referencedTypes` over the whole repo). Sorted by fan-out, top
 * `n`.
 */
export function possiblyUnused(
	files: FileNode[],
	derived: Derived,
	typeFiles: number[], // the file of each type declaration
	referenced: Set<number>,
	n = TOP
): number[] {
	const extended = new Set([...referenced].map((t) => typeFiles[t]));
	const order = byPath(files);
	return files
		.flatMap((f, i) =>
			derived.active[i] && derived.fanIn[i] === 0 && !f.isTest && !f.isEntry && !extended.has(i)
				? [i]
				: []
		)
		.sort((a, b) => derived.fanOut[b] - derived.fanOut[a] || order(a, b))
		.slice(0, n);
}
