import { groupOf, type Derived, type FileNode } from '#analysis/graph/index.ts';
import type { TypeDecl, TypeEdge } from '#analysis/types/index.ts';
import { buildGraphModel, type GraphModel } from './graphModel.ts';

// repograph-spec.md §11: the Architecture view's two diagrams, as plain data.

/** One box per folder group at `level`, joined by merged import arrows (cycle arrows
 * flagged, as in Dependencies). Every group is shown, connected or not. */
export function componentDiagram(files: FileNode[], derived: Derived, level: number): GraphModel {
	return buildGraphModel(files, derived, level, { hideUnconnected: false, onlyCycles: false });
}

export type ClassBox = { type: number; external: boolean };
export type ClassDiagram = { boxes: ClassBox[]; edges: TypeEdge[] };

/**
 * The class diagram for one package (a component box): every type declared in its
 * active files, the extends/implements arrows from them, and — faded — any supertype
 * that resolved to a declaration in a different package. Supertypes from outside the
 * repo resolve to nothing and aren't drawn.
 */
export function classDiagram(
	types: TypeDecl[],
	edges: TypeEdge[],
	files: FileNode[],
	active: boolean[],
	level: number,
	folder: string
): ClassDiagram {
	const inside = new Set<number>();
	types.forEach((t, i) => {
		if (active[t.file] && groupOf(files[t.file].path, level) === folder) inside.add(i);
	});
	const shown = edges.filter((e) => inside.has(e.child) && active[types[e.parent].file]);
	const external = [...new Set(shown.map((e) => e.parent).filter((p) => !inside.has(p)))];
	return {
		boxes: [
			...[...inside].map((type) => ({ type, external: false })),
			...external.sort((a, b) => a - b).map((type) => ({ type, external: true }))
		],
		edges: shown
	};
}

export const STEREOTYPE: Record<TypeDecl['kind'], string | null> = {
	class: null,
	abstract: '«abstract»',
	interface: '«interface»',
	enum: '«enum»',
	record: '«record»'
};
