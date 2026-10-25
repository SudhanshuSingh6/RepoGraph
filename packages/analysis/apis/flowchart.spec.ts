import { describe, expect, it } from 'vitest';
import type { FileNode } from '../graph/types.ts';
import {
	MAX_EXPAND_DEPTH,
	callMode,
	expandability,
	refKey,
	toFnChart,
	whenWords,
	type ChartCall,
	type FnChart,
	type StoredChartFunction
} from './flowchart.ts';

const file = (path: string, lang: FileNode['lang']): FileNode => ({
	path,
	lang,
	loc: 1,
	isTest: false,
	isEntry: false
});

const stored = (over: Partial<StoredChartFunction> & { name: string }): StoredChartFunction => ({
	owner: null,
	line: 1,
	end_line: 2,
	synthetic: false,
	abstract: false,
	calls: [],
	body: [],
	...over
});

const baseCall = {
	receiver: null,
	line: 3,
	guarded: false,
	args: 0,
	new: false
};

function chartOf(
	files: FileNode[],
	fns: Record<string, StoredChartFunction[]>,
	ref = { path: files[0].path, fn: 0 }
): FnChart {
	const functions = new Map(Object.entries(fns));
	const fileIndex = new Map(files.map((f, i) => [f.path, i]));
	return toFnChart(ref, functions, files, fileIndex)!;
}

describe('toFnChart', () => {
	it('carries resolved targets with their async flags, and untraced reasons', () => {
		const files = [file('a.ts', 'ts'), file('s.ts', 'ts')];
		const chart = chartOf(files, {
			'a.ts': [
				stored({
					name: 'h',
					is_async: true,
					calls: [
						{
							...baseCall,
							receiver: 'svc',
							name: 'load',
							target: { path: 's.ts', fn: 0 },
							awaited: true
						},
						{ ...baseCall, receiver: 'res', name: 'json', untraced: 'untyped' },
						{ ...baseCall, name: 'Plain', new: true, noConstructor: true }
					]
				})
			],
			's.ts': [stored({ name: 'load', owner: 'Svc', is_async: true })]
		});
		expect(chart.lang).toBe('js');
		expect(chart.isAsync).toBe(true);
		expect(chart.calls[0]).toMatchObject({
			label: 'svc.load',
			kind: 'target',
			awaited: true,
			targets: [{ label: 'Svc.load', file: 1, isAsync: true }]
		});
		expect(chart.calls[1]).toMatchObject({ kind: 'untraced', reason: 'untyped', targets: [] });
		expect(chart.calls[2]).toMatchObject({ kind: 'none', isNew: true });
	});
});

describe('callMode', () => {
	const caller = (lang: FnChart['lang'], isAsync = true) => ({ lang, isAsync }) as FnChart;
	const c = (over: Partial<ChartCall>): ChartCall => ({
		label: 'f',
		line: 1,
		guarded: false,
		when: null,
		context: null,
		awaited: false,
		isNew: false,
		kind: 'target',
		targets: [],
		implementations: null,
		reason: null,
		...over
	});
	const target = (isAsync: boolean, springAsync = false) => ({
		ref: { path: 'x', fn: 0 },
		file: 0,
		label: 'X.f',
		isAsync,
		springAsync
	});

	it('an awaited async call: the caller waits', () => {
		expect(callMode(c({ awaited: true, targets: [target(true)] }), caller('js')).mode).toBe(
			'awaited'
		);
	});
	it('an unawaited async call is deferred', () => {
		expect(callMode(c({ targets: [target(true)] }), caller('js'))).toEqual({
			mode: 'deferred',
			note: 'not awaited: the caller continues'
		});
	});
	it('Python: an unawaited coroutine is only created', () => {
		expect(callMode(c({ targets: [target(true)] }), caller('py')).note).toBe(
			'coroutine created, not run here'
		);
	});
	it('calls in .then and timers run later', () => {
		for (const context of ['then', 'timer'] as const) {
			expect(callMode(c({ context, targets: [target(false)] }), caller('js')).mode).toBe(
				'deferred'
			);
		}
	});
	it('a plain callback’s timing is not asserted (.map runs it now, a listener later)', () => {
		expect(callMode(c({ context: 'callback', targets: [target(false)] }), caller('js'))).toEqual({
			mode: 'callback',
			note: 'in a callback: runs if and when it is called'
		});
	});
	it('a Spring @Async method runs on another thread', () => {
		expect(callMode(c({ targets: [target(false, true)] }), caller('java', false))).toEqual({
			mode: 'deferred',
			note: 'runs on another thread (@Async)'
		});
	});
	it('an unresolved, unawaited call in an async JS function may return a promise', () => {
		expect(callMode(c({ kind: 'untraced', reason: 'library' }), caller('js'))).toEqual({
			mode: 'unknown',
			note: 'may return a promise (callee unknown)'
		});
	});
	it('an ordinary call is synchronous', () => {
		expect(callMode(c({ targets: [target(false)] }), caller('java', false)).mode).toBe('sync');
		expect(callMode(c({ kind: 'untraced', reason: 'library' }), caller('js', false)).mode).toBe(
			'sync'
		);
	});
});

describe('expandability', () => {
	const t = {
		ref: { path: 'a.ts', fn: 0 },
		file: 0,
		label: 'f',
		isAsync: false,
		springAsync: false
	};
	const call = { kind: 'target', targets: [t] } as ChartCall;
	it('refuses recursion, the depth limit and unresolved calls', () => {
		expect(expandability(call, [], 0)).toEqual({ ok: true });
		expect(expandability(call, [refKey(t.ref)], 1)).toEqual({
			ok: false,
			why: '↺ recursive call to f',
			blocked: 'recursive'
		});
		expect(expandability(call, [], MAX_EXPAND_DEPTH)).toEqual({
			ok: false,
			why: 'deeper calls not expanded',
			blocked: 'depth'
		});
		expect(expandability({ kind: 'untraced', targets: [] } as unknown as ChartCall, [], 0).ok).toBe(
			false
		);
	});
});

describe('whenWords', () => {
	it('describes each condition', () => {
		expect(whenWords({ op: '&&', left: 'a()' })).toBe('only if a() is truthy');
		expect(whenWords({ op: '?.', left: 'o' })).toBe("only if o isn't null or undefined");
		expect(whenWords({ op: '?', left: 'x', branch: false })).toBe('only if x is falsy');
		expect(whenWords(null)).toBeNull();
	});
});
