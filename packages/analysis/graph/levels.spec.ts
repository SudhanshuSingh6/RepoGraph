import { describe, expect, it } from 'vitest';
import {
	UNGROUPED,
	defaultGroupLevel,
	detailedLevelWithin,
	groupCount,
	groupLevels,
	groupOf
} from './levels.ts';
import type { FileNode } from './types.ts';

const files = (paths: string[]): FileNode[] =>
	paths.map((path) => ({ path, lang: 'ts', loc: 1, isTest: false, isEntry: false }));

describe('grouping levels', () => {
	it('runs 1..maxDirDepth then ungrouped', () => {
		expect(groupLevels(files(['a/b/c/x.ts', 'y.ts', 'a/z.ts']))).toEqual([1, 2, 3, UNGROUPED]);
		expect(groupLevels(files(['x.ts']))).toEqual([UNGROUPED]);
	});

	it('groups by leading folders', () => {
		expect(groupOf('a/b/c/x.ts', 1)).toBe('a');
		expect(groupOf('a/b/c/x.ts', 2)).toBe('a/b');
		expect(groupOf('a/x.ts', 3)).toBe('a');
		expect(groupOf('x.ts', 1)).toBe('x.ts');
		expect(groupOf('a/x.ts', UNGROUPED)).toBe('a/x.ts');
	});

	it('starts small repos (≤60 files) ungrouped', () => {
		const sixty = files(Array.from({ length: 60 }, (_, i) => `d${i}/f.ts`));
		expect(defaultGroupLevel(sixty)).toBe(UNGROUPED);
	});

	it('starts larger repos at the most detailed level with ≤120 groups', () => {
		// 10 top folders × 12 subfolders × 2 files = 240 files.
		// Level 1 → 10 groups, level 2 → 120 groups, level 3 (ungrouped-ish) → 240.
		const paths: string[] = [];
		for (let a = 0; a < 10; a++)
			for (let b = 0; b < 12; b++) for (let c = 0; c < 2; c++) paths.push(`a${a}/b${b}/c${c}/f.ts`);
		const fs = files(paths);
		expect(groupCount(fs, 2)).toBe(120);
		expect(groupCount(fs, 3)).toBe(240);
		expect(defaultGroupLevel(fs)).toBe(2);
	});

	it('falls back to level 1 when every level has >120 groups', () => {
		const many = files(Array.from({ length: 130 }, (_, i) => `d${i}/f.ts`));
		expect(defaultGroupLevel(many)).toBe(1);
	});

	it('Architecture: the most detailed folder level with ≤20 groups, never per-file', () => {
		const paths: string[] = [];
		for (let a = 0; a < 4; a++) for (let b = 0; b < 5; b++) paths.push(`a${a}/b${b}/f.ts`);
		const fs = files(paths); // level 1 → 4 groups, level 2 → 20
		expect(detailedLevelWithin(fs, 20)).toBe(2);
		expect(detailedLevelWithin(fs, 19)).toBe(1);
		expect(detailedLevelWithin(files(['x.ts', 'y.ts']), 20)).toBe(UNGROUPED); // no folders
	});
});
