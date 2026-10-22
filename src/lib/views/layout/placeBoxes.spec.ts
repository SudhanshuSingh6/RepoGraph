import { describe, expect, it } from 'vitest';
import { placeBoxes } from './placeBoxes.ts';

const box = { w: 100, h: 40 };
const items = [box, box, box];

/** The start point of an `M x,y L …` path. */
const start = (d: string) => d.slice(1, d.indexOf('L')).split(',').map(Number);

describe('placeBoxes', () => {
	it('puts boxes with no edge in a band below the layered ones', () => {
		const { boxes } = placeBoxes(items, [[0, 1]], [], 1000);
		expect(boxes[0].y).toBeLessThan(boxes[1].y);
		expect(boxes[2].y).toBeGreaterThan(boxes[1].y);
	});

	it('spreads arrows joining the same two boxes, in either direction', () => {
		const arrows = [
			{ from: 0, to: 1, key: 'a' },
			{ from: 1, to: 0, key: 'b' },
			{ from: 0, to: 1, key: 'c' }
		];
		const { lines } = placeBoxes(items, [[0, 1]], arrows, 1000);
		// Box 1 sits straight below box 0, so the spread is horizontal.
		const xs = lines.map((l) => start(l.d)[0]);
		expect(new Set(xs).size).toBe(3);
		expect(lines.every((l) => Math.abs(l.mid.x - 50) <= 8)).toBe(true);
	});

	it('draws an arrow from a box to itself as a loop off its right side, not a layer edge', () => {
		const { boxes, lines, width } = placeBoxes(
			[box],
			[[0, 0]],
			[{ from: 0, to: 0, key: 'self' }],
			1000
		);
		expect(lines[0].d).toMatch(/^M100,\d+C/);
		expect(lines[0].mid.x).toBeGreaterThan(boxes[0].x + box.w);
		expect(width).toBeGreaterThan(box.w);
	});
});
