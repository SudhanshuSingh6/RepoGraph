import { interpolateRgb, lab, scaleSequential } from 'd3';
import type { TreeNode } from '#analysis/graph/index.ts';
import { LANG_COLORS } from '#lib/workspace/langs.ts';
import type { ColorBy } from '#lib/workspace/state.svelte.ts';

// repograph-spec.md §9 names these ramps without giving end colors; these are ours.
export const FAN_IN_RAMP = ['#d4eeea', '#0b545b'] as const; // light teal → dark teal
export const FAN_OUT_RAMP = ['#f8edd3', '#b2500e'] as const; // cream → burnt orange

export type Fill = { fill: string; text: string };

const DARK_TEXT = '#0e2b33';
const LIGHT_TEXT = '#ffffff';

/** Label color that stays readable on a concrete fill color. */
export function textOn(color: string): string {
	return lab(color).l > 62 ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * The Size map's file fill for each "Color by" mode. `maxFanIn`/`maxFanOut` are the
 * whole (filtered) repo's, so colors don't shift when zooming into a folder.
 */
export function fileFill(
	mode: ColorBy,
	scales: { maxFanIn: number; maxFanOut: number },
	file: { node: TreeNode; fanIn: number; fanOut: number; inCycle: boolean }
): Fill {
	switch (mode) {
		case 'lang': {
			const c = LANG_COLORS[file.node.lang];
			return { fill: c, text: textOn(c) };
		}
		case 'fanIn': {
			const c = scaleSequential(interpolateRgb(...FAN_IN_RAMP)).domain([
				0,
				Math.max(scales.maxFanIn, 1)
			])(file.fanIn);
			return { fill: c, text: textOn(c) };
		}
		case 'fanOut': {
			const c = scaleSequential(interpolateRgb(...FAN_OUT_RAMP)).domain([
				0,
				Math.max(scales.maxFanOut, 1)
			])(file.fanOut);
			return { fill: c, text: textOn(c) };
		}
		case 'cycles':
			return file.inCycle
				? { fill: 'var(--accent)', text: LIGHT_TEXT }
				: { fill: 'var(--neutral)', text: 'var(--ink)' };
	}
}
