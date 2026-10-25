import { describe, expect, it } from 'vitest';
import { buildCfg, subtypeOf, visibleEdges, type Lang } from './cfg.ts';
import type { Case, Catch, Part, Step } from './steps.ts';

// Small builders for statement trees; `call` gives a statement one call so it "may throw".
const part = (text: string, calls: number[] = []): Part => ({ text, calls });
const s = (text: string, calls: number[] = []): Step => ({ kind: 'stmt', line: 1, text, calls });
const call = (text: string) => s(text, [0]);
const ret = (text = 'return'): Step => ({ kind: 'return', line: 1, text, value: null });
const thr = (text: string, type: string | null, chain?: string[], complete = false): Step => ({
	kind: 'throw',
	line: 1,
	text,
	value: null,
	type,
	typeChain: chain,
	chainComplete: complete
});
const brk = (label: string | null = null): Step => ({ kind: 'break', line: 1, label });
const cont = (label: string | null = null): Step => ({ kind: 'continue', line: 1, label });
const iff = (cond: Part, then: Step[], els: Step[] | null = null): Step => ({
	kind: 'if',
	line: 1,
	cond,
	then,
	else: els
});
const loop = (over: Partial<Extract<Step, { kind: 'loop' }>>): Step => ({
	kind: 'loop',
	line: 1,
	label: null,
	loop: 'while',
	cond: null,
	init: null,
	update: null,
	item: null,
	iterable: null,
	body: [],
	orelse: null,
	...over
});
const tryy = (
	body: Step[],
	catches: Catch[] = [],
	fin: Step[] | null = null,
	orelse: Step[] | null = null
): Step => ({ kind: 'try', line: 1, resources: null, body, catches, orelse, finally: fin });
const ctch = (types: string[] | null, body: Step[] = [], name = 'e'): Catch => ({
	line: 1,
	types,
	name,
	body
});

function edges(body: Step[], lang: Lang = 'java') {
	return visibleEdges(buildCfg(body, lang)).map((e) => `${e.from} -${e.label}-> ${e.to}`);
}

describe('sequence, if and reachability', () => {
	it('chains statements and merges if branches', () => {
		expect(edges([s('a'), iff(part('x'), [s('b')], [s('c')]), s('d')])).toEqual([
			'entry --> stmt:a',
			'stmt:a --> decision:x',
			'decision:x -yes-> stmt:b',
			'decision:x -no-> stmt:c',
			'stmt:b --> stmt:d',
			'stmt:c --> stmt:d',
			'stmt:d -end-> exit'
		]);
	});

	it('puts a condition’s calls in an eval node before the decision', () => {
		expect(edges([iff(part('check()', [0]), [s('b')])])).toContain(
			'eval:check() --> decision:check()'
		);
		expect(edges([iff(part('check()', [0]), [s('b')])])).toContain('entry --> eval:check()');
	});

	it('marks statements after a return unreachable', () => {
		const cfg = buildCfg([ret(), s('dead')], 'java');
		expect(cfg.nodes.find((n) => n.text === 'dead')!.unreachable).toBe(true);
		expect(cfg.nodes.find((n) => n.kind === 'return')!.unreachable).toBe(false);
	});
});

describe('loops', () => {
	it('while: checks before each iteration, so zero iterations reaches the exit', () => {
		const e = edges([loop({ cond: part('more()', [0]), body: [s('work')] }), s('after')]);
		expect(e).toEqual(
			expect.arrayContaining([
				'entry --> eval:more()',
				'eval:more() --> decision:more()',
				'decision:more() -yes-> stmt:work',
				'stmt:work -repeat-> eval:more()', // the condition's calls re-run each time
				'decision:more() -no-> stmt:after' // the zero-iteration path
			])
		);
	});

	it('do: runs the body, then checks', () => {
		const e = edges([
			loop({ loop: 'do', cond: part('again()', [0]), body: [s('work')] }),
			s('after')
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'entry --> stmt:work',
				'stmt:work --> eval:again()',
				'decision:again() -yes · repeat-> stmt:work',
				'decision:again() -no-> stmt:after'
			])
		);
		expect(e).not.toContain('entry --> eval:again()');
	});

	it('for: init once; continue goes to the update, then the condition', () => {
		const e = edges([
			loop({
				loop: 'for',
				init: [s('i = 0')],
				cond: part('i < n'),
				update: part('i++'),
				body: [iff(part('skip'), [cont()]), s('work')]
			})
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'entry --> stmt:i = 0',
				'stmt:i = 0 --> decision:i < n',
				'jump:continue -continue-> stmt:i++',
				'stmt:work --> stmt:i++',
				'stmt:i++ -repeat-> decision:i < n',
				'decision:i < n -no-> exit'
			])
		);
	});

	it('foreach: evaluates the iterable once; an empty collection skips the body', () => {
		const e = edges([
			loop({ loop: 'foreach', item: 'o', iterable: part('owners()', [0]), body: [s('use(o)')] })
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'entry --> eval:owners()',
				'eval:owners() --> decision:next o in owners()?',
				'decision:next o in owners()? -next item-> stmt:use(o)',
				'stmt:use(o) -repeat-> decision:next o in owners()?', // not back to the eval
				'decision:next o in owners()? -no more items-> exit'
			])
		);
	});

	it('break leaves the loop; a labelled break leaves the outer loop', () => {
		const inner = loop({ cond: part('b'), body: [iff(part('x'), [brk('outer')]), brk()] });
		const e = edges([
			loop({ label: 'outer', cond: part('a'), body: [inner, s('rest')] }),
			s('after')
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'jump:break outer -break-> stmt:after',
				'jump:break -break-> stmt:rest'
			])
		);
	});

	it('Python loop else runs on normal end, not after break', () => {
		const e = edges(
			[
				loop({ cond: part('c'), body: [iff(part('x'), [brk()])], orelse: [s('no break')] }),
				s('after')
			],
			'py'
		);
		expect(e).toEqual(
			expect.arrayContaining([
				'decision:c -no-> stmt:no break',
				'jump:break -break-> stmt:after',
				'stmt:no break --> stmt:after'
			])
		);
	});
});

describe('switch and match', () => {
	const sw = (cases: Case[], arrow = false, hasDefault = true): Step => ({
		kind: 'switch',
		line: 1,
		label: null,
		subject: part('v'),
		cases,
		arrow,
		hasDefault
	});
	const cs = (labels: string[], body: Step[], isDefault = false): Case => ({
		line: 1,
		labels,
		isDefault,
		body
	});

	it('groups empty labels, falls through without break, breaks to after the switch', () => {
		const e = edges([
			sw([
				cs(['1'], []),
				cs(['2'], [s('two')]),
				cs(['3'], [s('three'), brk()]),
				cs([], [s('dflt')], true)
			]),
			s('after')
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'decision:switch (v) -case 1 / case 2-> stmt:two',
				'stmt:two -falls through-> stmt:three',
				'decision:switch (v) -case 3-> stmt:three',
				'jump:break -break-> stmt:after',
				'decision:switch (v) -default-> stmt:dflt',
				'stmt:dflt --> stmt:after'
			])
		);
	});

	it('arrow cases never fall through; no default means "no case matched"', () => {
		const e = edges([sw([cs(['1'], [s('one')]), cs(['2'], [s('two')])], true, false), s('after')]);
		expect(e).toEqual(
			expect.arrayContaining([
				'stmt:one --> stmt:after',
				'stmt:two --> stmt:after',
				'decision:switch (v) -no case matched-> stmt:after'
			])
		);
		expect(e).not.toContain('stmt:one -falls through-> stmt:two');
	});

	it('break in a switch inside a loop leaves the switch; continue goes to the loop', () => {
		const e = edges([
			loop({
				cond: part('more'),
				body: [
					sw([cs(['1'], [s('one'), brk()]), cs(['2'], [cont()])], false, false),
					s('after switch')
				]
			}),
			s('after loop')
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'jump:break -break-> stmt:after switch',
				'jump:continue -continue-> decision:more'
			])
		);
		expect(e).not.toContain('jump:break -break-> stmt:after loop');
	});

	it('Python: break inside match inside a loop leaves the loop; cases are tried in order', () => {
		const m: Step = {
			kind: 'match',
			line: 1,
			label: null,
			subject: part('v'),
			cases: [
				cs(['1'], [brk()]),
				{ ...cs(['2'], [s('two')]), guard: part('ok()', [0]) },
				cs(['_'], [s('other')], true)
			],
			hasDefault: true
		};
		const e = edges(
			[loop({ cond: part('more'), body: [m, s('after match')] }), s('after loop')],
			'py'
		);
		expect(e).toEqual(
			expect.arrayContaining([
				'jump:break -break-> stmt:after loop',
				'decision:v matches 1? -no-> decision:v matches 2?',
				'decision:v matches 2? -yes-> eval:ok()',
				'decision:if ok() -no-> stmt:other',
				'decision:if ok() -yes-> stmt:two'
			])
		);
	});
});

describe('exceptions and catch order', () => {
	it('a known throw goes to the first applicable catch only', () => {
		const e = edges([
			tryy(
				[thr('throw new NotFound()', 'NotFound', ['NotFound', 'AppError'], true)],
				[ctch(['NotFound'], [s('a')]), ctch(['AppError'], [s('b')])]
			)
		]);
		expect(e).toContain('throw:throw new NotFound() -matches-> catch:catch (NotFound e)');
		expect(e.some((x) => x.includes('-> catch:catch (AppError e)') && x.startsWith('throw'))).toBe(
			false
		);
	});

	it('a resolved supertype catch first takes it; the later exact catch gets no edge', () => {
		const e = edges([
			tryy(
				[thr('throw new NotFound()', 'NotFound', ['NotFound', 'RuntimeException'], false)],
				[ctch(['RuntimeException']), ctch(['NotFound'])]
			)
		]);
		expect(e).toContain('throw:throw new NotFound() -matches-> catch:catch (RuntimeException e)');
		expect(e).not.toContain('throw:throw new NotFound() -matches-> catch:catch (NotFound e)');
	});

	it('an unresolvable library catch type first is "may match"; the exact one later matches', () => {
		const e = edges([
			tryy(
				[thr('throw new NotFound()', 'NotFound', ['NotFound', 'SomeLibError'], false)],
				[ctch(['FrameworkError']), ctch(['NotFound'])]
			)
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'throw:throw new NotFound() -may match-> catch:catch (FrameworkError e)',
				'throw:throw new NotFound() -matches-> catch:catch (NotFound e)'
			])
		);
	});

	it('a call in try may throw to every catch, in order, through the dispatch', () => {
		const e = edges([tryy([call('svc.go()')], [ctch(['A']), ctch(['B'])])]);
		expect(e).toEqual(
			expect.arrayContaining([
				'stmt:svc.go() -may throw-> dispatch:exception raised in try',
				'dispatch:exception raised in try -may match-> catch:catch (A e)',
				'dispatch:exception raised in try -may match-> catch:catch (B e)',
				'dispatch:exception raised in try -not caught here-> throws'
			])
		);
	});

	it('JS: the single catch takes everything', () => {
		const e = edges([tryy([call('go()')], [ctch(null, [], 'err')])], 'js');
		expect(e).toContain('dispatch:exception raised in try -matches-> catch:catch (err)');
		expect(e).not.toContain('dispatch:exception raised in try -not caught here-> throws');
	});

	it('outside any try, a throw goes to the caller', () => {
		expect(edges([thr('throw new X()', 'X')])).toContain(
			'throw:throw new X() -throws to caller-> throws'
		);
	});

	it('Python try/else: else runs only without an exception, and its exceptions skip the excepts', () => {
		const e = edges(
			[
				tryy([s('body')], [ctch(['ValueError'], [s('handle')])], null, [call('else_part()')]),
				s('after')
			],
			'py'
		);
		expect(e).toEqual(
			expect.arrayContaining([
				'stmt:body --> stmt:else_part()',
				'stmt:else_part() -may throw-> throws'
			])
		);
		expect(e).not.toContain('stmt:else_part() -may throw-> dispatch:exception raised in try');
	});
});

describe('finally', () => {
	it('a return inside try runs finally, then returns', () => {
		const e = edges([tryy([ret('return x')], [], [s('cleanup')]), s('after')]);
		expect(e).toEqual(
			expect.arrayContaining([
				'return:return x -on return-> finally:finally',
				'stmt:cleanup -then return-> exit'
			])
		);
	});

	it('an uncaught exception passes through finally, then rethrows to the enclosing try', () => {
		const inner = tryy([thr('throw new X()', 'X', ['X'], true)], [ctch(['Y'])], [s('cleanup')]);
		const e = edges([tryy([inner], [ctch(['X'], [s('outer handles')])])]);
		expect(e).toEqual(
			expect.arrayContaining([
				'throw:throw new X() -on exception-> finally:finally',
				'stmt:cleanup -then rethrow · matches-> catch:catch (X e)'
			])
		);
	});

	it('a return in finally replaces a pending exception (no rethrow)', () => {
		const cfg = buildCfg(
			[tryy([thr('throw new X()', 'X', ['X'], true)], [], [ret('return fallback')])],
			'java'
		);
		const e = visibleEdges(cfg).map((x) => `${x.from} -${x.label}-> ${x.to}`);
		expect(e).toContain('return:return fallback -return-> exit');
		expect(e.some((x) => x.includes('then rethrow'))).toBe(false);
		expect(cfg.nodes.find((n) => n.text === 'return fallback')!.overrides).toBe(true);
	});

	it('a throw in finally replaces a pending return', () => {
		const e = edges([tryy([ret('return ok')], [], [thr('throw new Boom()', 'Boom')])]);
		expect(e).toContain('throw:throw new Boom() -throws to caller-> throws');
		expect(e.some((x) => x.includes('then return'))).toBe(false);
	});

	it('a finally that returns on one branch keeps "then …" edges from its other branch', () => {
		const e = edges([
			tryy([ret('return ok')], [], [iff(part('bad'), [ret('return override')]), s('log')])
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'stmt:log -then return-> exit',
				'return:return override -return-> exit'
			])
		);
	});

	it('try-with-resources closes before any catch, and on normal completion', () => {
		const twr: Step = {
			kind: 'try',
			line: 1,
			resources: part('var r = open()', [0]),
			body: [call('use(r)')],
			catches: [ctch(['IOException'], [s('handle')])],
			orelse: null,
			finally: null
		};
		const e = edges([twr, s('after')]);
		expect(e).toEqual(
			expect.arrayContaining([
				'stmt:use(r) -normal-> close:close resources',
				'stmt:use(r) -on exception-> close:close resources',
				'close:close resources -then rethrow · may throw-> dispatch:exception raised in try',
				'close:close resources --> stmt:after'
			])
		);
	});

	it('break inside try … finally runs finally, then breaks', () => {
		const e = edges([
			loop({ cond: part('more'), body: [tryy([brk()], [], [s('cleanup')])] }),
			s('after')
		]);
		expect(e).toEqual(
			expect.arrayContaining([
				'jump:break -on break-> finally:finally',
				'stmt:cleanup -then break-> stmt:after'
			])
		);
	});
});

describe('subtypeOf', () => {
	it('uses the repo chain, then the builtin table where the chain leaves the repo', () => {
		expect(subtypeOf(['NotFound', 'AppError'], true, 'AppError', 'java')).toBe(true);
		expect(subtypeOf(['NotFound', 'AppError'], true, 'Other', 'java')).toBe(false);
		expect(
			subtypeOf(['NotFound', 'IllegalArgumentException'], false, 'RuntimeException', 'java')
		).toBe(true);
		expect(subtypeOf(['NotFound', 'IllegalArgumentException'], false, 'IOException', 'java')).toBe(
			false
		);
		expect(subtypeOf(['NotFound', 'LibraryError'], false, 'RuntimeException', 'java')).toBe(
			'maybe'
		);
		expect(subtypeOf(['MyErr', 'ValueError'], false, 'Exception', 'py')).toBe(true);
	});
});
