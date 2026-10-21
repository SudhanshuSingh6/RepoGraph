import { describe, expect, it } from 'vitest';
import { clipToBox, computeLayerPositions, layerNodes, type DagEdge } from './layeredDag.ts';

const box = { w: 100, h: 40 };
const GAP = { x: 20, y: 50 };

function crossings(order: number[][], edges: DagEdge[], layers: number[]): number {
	const at = new Map<number, number>();
	order.forEach((row) => row.forEach((v, k) => at.set(v, k)));
	const between = edges.filter(([a, b]) => Math.abs(layers[a] - layers[b]) === 1);
	let n = 0;
	for (let i = 0; i < between.length; i++)
		for (let j = i + 1; j < between.length; j++) {
			const [a, b] = between[i].map((v) => at.get(v)!) as [number, number];
			const [c, d] = between[j].map((v) => at.get(v)!) as [number, number];
			if ((a - c) * (b - d) < 0) n++;
		}
	return n;
}

describe('layerNodes', () => {
	it('puts each node one layer below the deepest node pointing at it', () => {
		// 0 → 1 → 2, 0 → 2, 3 isolated
		expect(
			layerNodes(4, [
				[0, 1],
				[1, 2],
				[0, 2]
			])
		).toEqual([0, 1, 2, 0]);
	});

	it('keeps a cycle in one layer and still layers what it points at', () => {
		// 0 → 1 ⇄ 2 → 3
		expect(
			layerNodes(4, [
				[0, 1],
				[1, 2],
				[2, 1],
				[2, 3]
			])
		).toEqual([0, 1, 1, 2]);
	});

	it('ignores self-edges', () => {
		expect(
			layerNodes(2, [
				[0, 0],
				[0, 1]
			])
		).toEqual([0, 1]);
	});
});

describe('computeLayerPositions', () => {
	it('stacks rows and centres each on the widest', () => {
		const layers = [0, 1, 1];
		const { positions, width, height } = computeLayerPositions(
			layers,
			[
				[0, 1],
				[0, 2]
			],
			[box, box, box],
			GAP
		);
		expect(width).toBe(220);
		expect(height).toBe(130);
		expect(positions[0]).toEqual({ x: 60, y: 0 });
		expect(positions.slice(1).map((p) => p.y)).toEqual([90, 90]);
	});

	it('untangles crossing edges', () => {
		// Top row 0, 1; bottom row 2, 3 — edges 0 → 3 and 1 → 2 cross in input order.
		const layers = [0, 0, 1, 1];
		const edges: DagEdge[] = [
			[0, 3],
			[1, 2]
		];
		expect(
			crossings(
				[
					[0, 1],
					[2, 3]
				],
				edges,
				layers
			)
		).toBe(1);
		const { positions } = computeLayerPositions(layers, edges, [box, box, box, box], GAP);
		const order = [0, 1].map((l) =>
			[0, 1, 2, 3].filter((v) => layers[v] === l).sort((a, b) => positions[a].x - positions[b].x)
		);
		expect(crossings(order, edges, layers)).toBe(0);
	});
});

describe('computeLayerPositions wrapping', () => {
	it('continues a too-wide layer on the next line', () => {
		const { positions, width, height } = computeLayerPositions(
			[0, 0, 0, 0, 0],
			[],
			Array(5).fill(box),
			GAP,
			340 // room for 3 boxes: 3 × 100 + 2 × 20
		);
		expect(width).toBe(340);
		expect(positions.map((p) => p.y)).toEqual([0, 0, 0, 90, 90]);
		expect(positions[3].x).toBe(breakX(2));
		expect(height).toBe(130);
	});
});

const breakX = (count: number) => (340 - (count * 100 + (count - 1) * 20)) / 2;

describe('clipToBox', () => {
	it('meets the border on the side facing the target', () => {
		const b = { x: 0, y: 0, w: 100, h: 40 };
		expect(clipToBox(b, 50, 200)).toEqual({ x: 50, y: 40 });
		expect(clipToBox(b, 250, 20)).toEqual({ x: 100, y: 20 });
	});
});
