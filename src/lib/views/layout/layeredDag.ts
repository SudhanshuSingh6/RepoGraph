import { tarjan } from '#analysis/graph/index.ts';

// repograph-spec.md §11: the layered-DAG layout shared by the Architecture (component and
// class) and ER diagrams — essentially a simplified Sugiyama layout.

export type DagEdge = [from: number, to: number];
export type Size = { w: number; h: number };
export type Placed = { x: number; y: number }; // top-left corner

/**
 * Buckets nodes by longest-path depth from the sources: a node sits one layer below the
 * deepest node with an edge into it. Edges inside an import cycle (an SCC) are ignored,
 * so a cycle's members share a layer instead of pushing each other down forever.
 */
export function layerNodes(n: number, edges: DagEdge[]): number[] {
	const adj: number[][] = Array.from({ length: n }, () => []);
	for (const [a, b] of edges) if (a !== b) adj[a].push(b);
	const comp = Array.from({ length: n }, (_, i) => i);
	tarjan(adj).forEach((group) => group.forEach((i) => (comp[i] = group[0])));

	const out = new Map<number, Set<number>>();
	const indegree = new Map<number, number>();
	for (let i = 0; i < n; i++) indegree.set(comp[i], indegree.get(comp[i]) ?? 0);
	for (const [a, b] of edges) {
		const [ca, cb] = [comp[a], comp[b]];
		if (ca === cb) continue;
		const set = out.get(ca) ?? new Set<number>();
		if (set.has(cb)) continue;
		set.add(cb);
		out.set(ca, set);
		indegree.set(cb, indegree.get(cb)! + 1);
	}
	const layer = new Map<number, number>();
	const queue = [...indegree].filter(([, d]) => d === 0).map(([c]) => c);
	for (const c of queue) layer.set(c, 0);
	for (let head = 0; head < queue.length; head++) {
		const c = queue[head];
		for (const d of out.get(c) ?? []) {
			layer.set(d, Math.max(layer.get(d) ?? 0, layer.get(c)! + 1));
			indegree.set(d, indegree.get(d)! - 1);
			if (indegree.get(d) === 0) queue.push(d);
		}
	}
	return comp.map((c) => layer.get(c) ?? 0);
}

const SWEEPS = 4;

/**
 * Orders each layer's row to reduce edge crossings (barycenter heuristic: alternate
 * down/up sweeps, each node moving toward the mean position of its neighbours in the
 * adjacent row), then assigns coordinates: rows stacked top to bottom, each row
 * centred on the widest one, wrapping onto extra lines past `wrap` pixels.
 */
export function computeLayerPositions(
	layers: number[],
	edges: DagEdge[],
	sizes: Size[],
	gap: { x: number; y: number },
	wrap = Infinity
): { positions: Placed[]; width: number; height: number } {
	const n = layers.length;
	const depth = n ? Math.max(...layers) + 1 : 0;
	const rows: number[][] = Array.from({ length: depth }, () => []);
	layers.forEach((l, i) => rows[l].push(i));

	const neighbours: number[][] = Array.from({ length: n }, () => []);
	for (const [a, b] of edges) {
		if (a === b) continue;
		neighbours[a].push(b);
		neighbours[b].push(a);
	}
	const pos = new Array<number>(n).fill(0);
	const index = () => rows.forEach((row) => row.forEach((v, k) => (pos[v] = k)));
	index();

	const reorder = (l: number, ref: number) => {
		const keyed = rows[l].map((v) => {
			const adjacent = neighbours[v].filter((w) => layers[w] === ref);
			const bary = adjacent.length
				? adjacent.reduce((s, w) => s + pos[w], 0) / adjacent.length
				: pos[v];
			return { v, bary, k: pos[v] };
		});
		keyed.sort((p, q) => p.bary - q.bary || p.k - q.k);
		rows[l] = keyed.map((p) => p.v);
		rows[l].forEach((v, k) => (pos[v] = k));
	};
	for (let s = 0; s < SWEEPS; s++) {
		for (let l = 1; l < depth; l++) reorder(l, l - 1);
		for (let l = depth - 2; l >= 0; l--) reorder(l, l + 1);
	}

	// A layer wider than `wrap` continues on the next line (a package of many unrelated
	// classes would otherwise be one long, unreadably-scaled row).
	const lines: number[][] = [];
	for (const row of rows) {
		let line: number[] = [];
		let used = 0;
		for (const v of row) {
			const add = (line.length ? gap.x : 0) + sizes[v].w;
			if (line.length && used + add > wrap) {
				lines.push(line);
				line = [];
				used = 0;
			}
			used += (line.length ? gap.x : 0) + sizes[v].w;
			line.push(v);
		}
		lines.push(line);
	}

	const lineWidth = lines.map(
		(line) => line.reduce((s, v) => s + sizes[v].w, 0) + Math.max(0, line.length - 1) * gap.x
	);
	const width = Math.max(0, ...lineWidth);
	const positions: Placed[] = new Array(n);
	let top = 0;
	lines.forEach((line, l) => {
		const lineH = Math.max(0, ...line.map((v) => sizes[v].h));
		let x = (width - lineWidth[l]) / 2;
		for (const v of line) {
			positions[v] = { x, y: top + (lineH - sizes[v].h) / 2 };
			x += sizes[v].w + gap.x;
		}
		top += lineH + gap.y;
	});
	return { positions, width, height: Math.max(0, top - gap.y) };
}

/** Where a line from a box's centre toward (tx, ty) leaves the box — so arrows start and
 * end on box borders rather than centres. */
export function clipToBox(box: Placed & Size, tx: number, ty: number): { x: number; y: number } {
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	const dx = tx - cx;
	const dy = ty - cy;
	if (dx === 0 && dy === 0) return { x: cx, y: cy };
	const scale = Math.min(
		dx ? box.w / 2 / Math.abs(dx) : Infinity,
		dy ? box.h / 2 / Math.abs(dy) : Infinity
	);
	return { x: cx + dx * scale, y: cy + dy * scale };
}
