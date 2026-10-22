import type { EntityDecl, EntityEdge } from '#analysis/types/index.ts';

// repograph-spec.md §12: the ER Diagram, as plain data.

export const MAX_FIELDS = 8; // rows per box before "+N more"

/** The entities in active files (language chips and Hide tests apply), and the resolved
 * relationships between them. */
export function erDiagram(
	entities: EntityDecl[],
	edges: EntityEdge[],
	active: boolean[]
): { shown: number[]; edges: EntityEdge[] } {
	const shown = entities.flatMap((e, i) => (active[e.file] ? [i] : []));
	const on = new Set(shown);
	return { shown, edges: edges.filter((e) => on.has(e.from) && on.has(e.to)) };
}

/** A box's field rows, primary keys bold, cut to `MAX_FIELDS` with the rest counted. */
export function fieldRows(entity: EntityDecl): {
	rows: { text: string; bold: boolean }[];
	more: number;
} {
	const rows = entity.fields.map((f) => ({
		text: f.type ? `${f.name}: ${f.type}` : f.name,
		bold: f.pk
	}));
	if (rows.length <= MAX_FIELDS) return { rows, more: 0 };
	return { rows: rows.slice(0, MAX_FIELDS), more: rows.length - MAX_FIELDS };
}
