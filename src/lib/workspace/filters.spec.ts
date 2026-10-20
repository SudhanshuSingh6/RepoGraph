import { describe, expect, it } from 'vitest';
import type { FileNode } from '#analysis/graph/index.ts';
import { activeMask, langCounts, matchesSearch } from './filters.ts';

const files: FileNode[] = [
	{ path: 'web/app.ts', lang: 'ts', loc: 10, isTest: false },
	{ path: 'web/app.test.ts', lang: 'ts', loc: 5, isTest: true },
	{ path: 'api/main.py', lang: 'py', loc: 20, isTest: false },
	{ path: 'api/Job.java', lang: 'java', loc: 30, isTest: false }
];

describe('activeMask', () => {
	it('keeps every file by default', () => {
		expect(activeMask(files, {}, false)).toEqual([true, true, true, true]);
	});

	it('drops languages switched off and, when hidden, tests', () => {
		expect(activeMask(files, { py: false }, false)).toEqual([true, true, false, true]);
		expect(activeMask(files, { ts: true }, true)).toEqual([true, false, true, true]);
	});
});

describe('matchesSearch', () => {
	it('is a case-insensitive substring match over the path', () => {
		expect(matchesSearch('web/src/State/store.ts', 'state/STORE')).toBe(true);
		expect(matchesSearch('web/src/state/store.ts', 'render')).toBe(false);
	});

	it('matches everything when the box is empty or blank', () => {
		expect(matchesSearch('a.py', '')).toBe(true);
		expect(matchesSearch('a.py', '   ')).toBe(true);
	});
});

describe('langCounts', () => {
	it('lists the languages present in a fixed order, with file counts', () => {
		expect(langCounts(files, false)).toEqual([
			{ lang: 'java', files: 1 },
			{ lang: 'ts', files: 2 },
			{ lang: 'py', files: 1 }
		]);
	});

	it('leaves tests out of the counts while they are hidden', () => {
		expect(langCounts(files, true).find((c) => c.lang === 'ts')).toEqual({ lang: 'ts', files: 1 });
	});
});
