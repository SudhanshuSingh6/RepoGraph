import { describe, expect, it } from 'vitest';
import cases from '../../../tests/fixtures/filter-cases.json';
import { keepPath, langOf } from './filters';

// Same cases as tests/unit/test_filter_parity.py, so the TS and Python rules agree.
describe('keepPath (parity with workers/filters.py)', () => {
	it.each(cases.kept)('keeps %s', (path) => expect(keepPath(path)).toBe(true));
	it.each(cases.dropped)('drops %s', (path) => expect(keepPath(path)).toBe(false));
});

describe('langOf', () => {
	it('maps every extension from §5.1', () => {
		expect(['A.java', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs'].map(langOf)).toEqual([
			'java',
			'js',
			'js',
			'js',
			'js'
		]);
		expect(['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.py', 'a.go'].map(langOf)).toEqual([
			'ts',
			'ts',
			'ts',
			'ts',
			'py',
			null
		]);
	});
});
