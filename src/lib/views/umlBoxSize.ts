// Box geometry shared by UmlBox.svelte and the diagrams that size its boxes.

export const FIELD_ROW = 16; // px per field-list row

/** A box's height: its header (stereotype, title, subtitle), then any field rows. */
export function boxHeight(stereotype: boolean, rows: number, more: boolean): number {
	const header = stereotype ? 74 : 56;
	const lines = rows + (more ? 1 : 0);
	return lines ? header - 8 + lines * FIELD_ROW + 8 : header;
}
