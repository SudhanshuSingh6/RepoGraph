import {
	clipToBox,
	computeLayerPositions,
	layerNodes,
	type DagEdge,
	type Placed,
	type Size
} from './layeredDag.ts';

// Box-and-arrow diagrams (repograph-spec.md §11/§12) on the layered-DAG layout: the
// Architecture view's component and class diagrams, and the ER Diagram.

export type Arrow = { from: number; to: number; key: string };
export type PlacedArrow<A extends Arrow> = A & {
	d: string;
	mid: { x: number; y: number }; // where a label goes
};

const GAP = { x: 28, y: 64 };
const PARALLEL = 8; // px between arrows joining the same two boxes
const LOOP = 34; // how far a self-relationship's loop reaches past the box

/**
 * Lays out boxes in layers and routes arrows between their borders. `layout` edges are
 * [above, below] pairs; `arrows` are what gets drawn. Boxes with no `layout` edge go in
 * a band below the layered ones, so arrows between layers don't pass behind them, and
 * a layer wider than `wrap` continues on another row. Arrows joining the same two
 * boxes (either way) are spread apart rather than drawn on top of each other; an arrow
 * from a box to itself is a loop off its right side.
 */
export function placeBoxes<B extends Size, A extends Arrow>(
	items: B[],
	layout: DagEdge[],
	arrows: A[],
	wrap: number
): { boxes: (B & Placed)[]; lines: PlacedArrow<A>[]; width: number; height: number } {
	const between = layout.filter(([a, b]) => a !== b);
	const linked = new Set(between.flat());
	const layered = layerNodes(items.length, between);
	const bottom = Math.max(-1, ...layered.filter((_, i) => linked.has(i))) + 1;
	const layers = layered.map((l, i) => (linked.has(i) ? l : bottom));
	const placed = computeLayerPositions(layers, between, items, GAP, wrap);
	const { positions, height } = placed;
	// Room for loops off the rightmost boxes.
	const width = placed.width + (arrows.some((a) => a.from === a.to) ? LOOP + 24 : 0);
	const boxes = items.map((b, i) => ({ ...b, ...positions[i] }));

	const pairKey = (a: Arrow) => (a.from < a.to ? `${a.from}-${a.to}` : `${a.to}-${a.from}`);
	const groups = new Map<string, A[]>();
	for (const a of arrows) {
		const list = groups.get(pairKey(a));
		if (list) list.push(a);
		else groups.set(pairKey(a), [a]);
	}

	const lines = arrows.map((a): PlacedArrow<A> => {
		const group = groups.get(pairKey(a))!;
		const k = group.indexOf(a);
		const s = boxes[a.from];
		if (a.from === a.to) {
			// Stacked loops off the right edge, one per self-relationship.
			const y0 = s.y + Math.min(s.h / 2, 20) + k * 14;
			const x0 = s.x + s.w;
			const reach = LOOP + k * 10;
			return {
				...a,
				d: `M${x0},${y0}C${x0 + reach},${y0 - 18} ${x0 + reach},${y0 + 30} ${x0},${y0 + 12}`,
				mid: { x: x0 + reach * 0.75 + 6, y: y0 + 6 }
			};
		}
		const t = boxes[a.to];
		const p = clipToBox(s, t.x + t.w / 2, t.y + t.h / 2);
		const q = clipToBox(t, s.x + s.w / 2, s.y + s.h / 2);
		// Offset perpendicular to the pair's canonical direction (low index → high), so
		// two arrows the opposite way each sit on their own side.
		const flip = a.from < a.to ? 1 : -1;
		const off = (k - (group.length - 1) / 2) * PARALLEL * flip;
		const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
		const ox = ((q.y - p.y) / len) * off;
		const oy = (-(q.x - p.x) / len) * off;
		return {
			...a,
			d: `M${p.x + ox},${p.y + oy}L${q.x + ox},${q.y + oy}`,
			mid: { x: (p.x + q.x) / 2 + ox, y: (p.y + q.y) / 2 + oy }
		};
	});
	return { boxes, lines, width, height };
}
