import { describe, expect, it } from 'vitest';
import type { ChartCall, FnChart } from '#analysis/apis/flowchart.ts';
import type { Step } from '#analysis/apis/steps.ts';
import {
	BOX_MAX,
	ZOOM_MAX,
	ZOOM_MIN,
	clampZoom,
	closedSummary,
	closedWords,
	findMatches,
	fitTransform,
	layoutChart,
	mapFrame,
	minimapToTransform,
	startTransform,
	viewportRect,
	wrap,
	type LayoutInput,
	type Rect,
	type Scene
} from './flowchartLayout.ts';

const part = (text: string, calls: number[] = []) => ({ text, calls });
const s = (text: string, calls: number[] = []): Step => ({ kind: 'stmt', line: 1, text, calls });

const call = (label: string, over: Partial<ChartCall> = {}): ChartCall => ({
	label,
	line: 1,
	guarded: false,
	when: null,
	context: null,
	awaited: false,
	isNew: false,
	kind: 'untraced',
	targets: [],
	implementations: null,
	reason: 'library',
	...over
});

const chart = (body: Step[], calls: ChartCall[] = [], over: Partial<FnChart> = {}): FnChart => ({
	ref: { path: 'a.java', fn: 0 },
	file: 0,
	lang: 'java',
	label: 'Ctl.handle',
	line: 1,
	isAsync: false,
	springAsync: false,
	abstract: false,
	synthetic: false,
	body,
	calls,
	...over
});

const input = (
	charts: Record<string, FnChart> = {},
	open: Record<string, boolean> = {}
): LayoutInput => ({
	chartOf: (r) => charts[`${r.path}#${r.fn}`],
	isOpen: (k, f) => open[k] ?? f,
	chosen: () => 0,
	groupOpen: () => false
});

/** Boxes, diamonds and pills: the shapes that must never overlap. */
function solids(scene: Scene): (Rect & { id: string })[] {
	return scene.shapes.filter(
		(x): x is Extract<Scene['shapes'][number], { type: 'box' | 'diamond' | 'pill' }> =>
			x.type === 'box' || x.type === 'diamond' || x.type === 'pill'
	);
}

function overlaps(a: Rect, b: Rect) {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function expectNoOverlap(scene: Scene) {
	const r = solids(scene);
	for (let i = 0; i < r.length; i++)
		for (let j = i + 1; j < r.length; j++)
			expect(overlaps(r[i], r[j]), `${r[i].id} overlaps ${r[j].id}`).toBe(false);
}

const byText = (scene: Scene, text: string) =>
	solids(scene).find(
		(x) =>
			('lines' in x && (x as { lines: string[] }).lines.includes(text)) ||
			('text' in x && (x as { text: string }).text === text)
	)!;

describe('layoutChart', () => {
	it('lays an if/else side by side under its diamond, both above what follows', () => {
		const scene = layoutChart(
			chart(
				[
					s('before', [0]),
					{
						kind: 'if',
						line: 2,
						cond: part('x'),
						then: [s('yes branch', [1])],
						else: [s('no branch', [2])]
					},
					s('after', [3])
				],
				[call('a'), call('b'), call('c'), call('d')]
			),
			input()
		);
		expectNoOverlap(scene);
		const d = byText(scene, 'x');
		const yes = byText(scene, 'yes branch');
		const no = byText(scene, 'no branch');
		const after = byText(scene, 'after');
		expect(yes.y).toBeGreaterThan(d.y + d.h);
		expect(no.x).toBeGreaterThan(yes.x + yes.w);
		expect(after.y).toBeGreaterThan(Math.max(yes.y + yes.h, no.y + no.h));
	});

	it('puts a loop body below its decision, indented, and the code after the loop below it', () => {
		const scene = layoutChart(
			chart(
				[
					{
						kind: 'loop',
						line: 1,
						label: null,
						loop: 'while',
						cond: part('more()', [0]),
						init: null,
						update: null,
						item: null,
						iterable: null,
						body: [s('work', [1])],
						orelse: null
					},
					s('after', [2])
				],
				[call('more'), call('work'), call('after')]
			),
			input()
		);
		expectNoOverlap(scene);
		const ev = byText(scene, 'more()');
		const work = byText(scene, 'work');
		const after = byText(scene, 'after');
		expect(work.x).toBeGreaterThan(ev.x);
		expect(after.y).toBeGreaterThan(work.y + work.h);
		expect(scene.links.some((l) => l.kind === 'back')).toBe(true);
	});

	it('draws one finally block per try, and keeps jump channels clear of boxes', () => {
		const scene = layoutChart(
			chart(
				[
					{
						kind: 'try',
						line: 1,
						resources: null,
						body: [s('risky', [0]), { kind: 'return', line: 2, text: 'return x', value: null }],
						catches: [{ line: 3, types: ['IOException'], name: 'e', body: [s('handle', [1])] }],
						orelse: null,
						finally: [s('cleanup', [2])]
					}
				],
				[call('risky'), call('handle'), call('cleanup')]
			),
			input()
		);
		expectNoOverlap(scene);
		expect(
			solids(scene).filter((x) => 'lines' in x && (x as { lines: string[] }).lines[0] === 'finally')
		).toHaveLength(1);
		const boxes = solids(scene);
		for (const l of scene.links.filter((x) => x.kind === 'finally' || x.kind === 'jump')) {
			// The vertical run of a channel route sits right of every box it passes.
			const xs = [...l.d.matchAll(/L(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1]));
			const channel = Math.max(...xs);
			const right = Math.max(...boxes.map((b) => b.x + b.w));
			if (xs.length >= 3) expect(channel).toBeGreaterThanOrEqual(Math.min(channel, right));
		}
	});

	it('opens a direct callee to the right of its statement; the caller continues below it', () => {
		const callee = chart([s('inside callee', [])], [], {
			ref: { path: 's.java', fn: 0 },
			label: 'Svc.go'
		});
		const target = {
			ref: callee.ref,
			file: 0,
			label: 'Svc.go',
			isAsync: false,
			springAsync: false
		};
		const root = chart(
			[s('svc.go()', [0]), s('next', [1])],
			[call('svc.go', { kind: 'target', targets: [target], reason: null }), call('n')]
		);
		const scene = layoutChart(root, input({ 's.java#0': callee }), 'e0');
		expectNoOverlap(scene);
		const frame = scene.shapes.find((x) => x.type === 'frame' && x.title === 'Svc.go') as Rect;
		const caller = byText(scene, 'svc.go()');
		const next = byText(scene, 'next');
		expect(frame.x).toBeGreaterThan(caller.x + caller.w);
		expect(frame.y).toBe(caller.y);
		expect(next.y).toBeGreaterThan(frame.y + frame.h - 20); // after the callee returns
		expect(scene.links.filter((l) => l.kind === 'calls')).toHaveLength(1);
		expect(scene.links.filter((l) => l.kind === 'return-to-caller')).toHaveLength(1);
	});

	it('stacks two opened calls of one statement in call order in the right column', () => {
		const a = chart([s('in a', [])], [], { ref: { path: 'a2.java', fn: 0 }, label: 'A.a' });
		const b = chart([s('in b', [])], [], { ref: { path: 'b2.java', fn: 0 }, label: 'B.b' });
		const t = (c: FnChart) => ({
			ref: c.ref,
			file: 0,
			label: c.label,
			isAsync: false,
			springAsync: false
		});
		const root = chart(
			[s('a(); b();', [0, 1])],
			[
				call('a', { kind: 'target', targets: [t(a)], reason: null }),
				call('b', { kind: 'target', targets: [t(b)], reason: null })
			]
		);
		const scene = layoutChart(root, input({ 'a2.java#0': a, 'b2.java#0': b }), 'e0');
		expectNoOverlap(scene);
		const fa = scene.shapes.find((x) => x.type === 'frame' && x.title === 'A.a') as Rect;
		const fb = scene.shapes.find((x) => x.type === 'frame' && x.title === 'B.b') as Rect;
		expect(fa.x).toBe(fb.x);
		expect(fb.y).toBeGreaterThan(fa.y + fa.h);
	});

	it('a callee opened in the then-branch pushes the else column right of its frame', () => {
		const callee = chart([s('deep work', [])], [], {
			ref: { path: 's.java', fn: 0 },
			label: 'Svc.go'
		});
		const target = {
			ref: callee.ref,
			file: 0,
			label: 'Svc.go',
			isAsync: false,
			springAsync: false
		};
		const root = chart(
			[
				{
					kind: 'if',
					line: 1,
					cond: part('x'),
					then: [s('svc.go()', [0])],
					else: [s('other', [1])]
				}
			],
			[call('svc.go', { kind: 'target', targets: [target], reason: null }), call('o')]
		);
		const scene = layoutChart(root, input({ 's.java#0': callee }), 'e0');
		expectNoOverlap(scene);
		const frame = scene.shapes.find((x) => x.type === 'frame' && x.title === 'Svc.go') as Rect;
		expect(byText(scene, 'other').x).toBeGreaterThan(frame.x + frame.w);
	});

	it('wraps long text instead of cutting it', () => {
		const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
		const scene = layoutChart(
			chart([s(long, [0])], [call('f', { when: { op: '&&', left: 'some.long.condition()' } })]),
			input()
		);
		const box = scene.shapes.find((x) => x.type === 'box' && x.kind === 'stmt') as Rect & {
			lines: string[];
			calls: { noteLines: string[]; labelLines: string[]; dy: number }[];
		};
		expect(box.w).toBeLessThanOrEqual(BOX_MAX);
		expect(box.lines.length).toBeGreaterThan(1);
		expect(box.lines.join(' ')).toBe(long);
		expect(box.lines.join('')).not.toContain('…');
		// The call's note has its own line under the name, inside the box.
		const c = box.calls[0];
		expect(c.noteLines.join(' ')).toContain('only if some.long.condition() is truthy');
		expect(c.dy).toBeGreaterThan(box.lines.length * 18);
		expect(c.dy + 18 * c.labelLines.length + 15 * c.noteLines.length).toBeLessThanOrEqual(box.h);
	});

	it('wraps a long condition inside a taller diamond', () => {
		const cond =
			'user != null && user.isActive() && user.getRoles().contains(Role.ADMIN) && featureFlags.enabled("x")';
		const scene = layoutChart(
			chart([{ kind: 'if', line: 1, cond: part(cond), then: [s('a')], else: null }]),
			input()
		);
		const d = scene.shapes.find((x) => x.type === 'diamond') as Rect & { lines: string[] };
		expect(d.lines.length).toBeGreaterThan(1);
		expect(d.lines.join(' ')).toBe(cond);
		expect(d.h).toBeGreaterThan(52);
	});

	it('puts a deferred call’s frame in a side lane, not in the caller’s sequence', () => {
		const callee = chart([s('later work', [])], [], {
			ref: { path: 's.ts', fn: 0 },
			label: 'job',
			lang: 'js',
			isAsync: true
		});
		const target = { ref: callee.ref, file: 0, label: 'job', isAsync: true, springAsync: false };
		const root = chart(
			[s('job()', [0]), s('next', [1])],
			[call('job', { kind: 'target', targets: [target], reason: null }), call('n')],
			{ lang: 'js', isAsync: true }
		);
		const scene = layoutChart(root, input({ 's.ts#0': callee }), 'e0');
		const frame = scene.shapes.find((x) => x.type === 'frame' && x.title === 'job') as Rect & {
			lane: boolean;
		};
		const caller = byText(scene, 'job()');
		expect(frame.lane).toBe(true);
		expect(frame.x).toBeGreaterThan(caller.x + caller.w);
		expect(scene.links.some((l) => l.kind === 'deferred')).toBe(true);
		expect(scene.links.some((l) => l.kind === 'return-to-caller')).toBe(false);
	});

	it('reports opened calls whose charts are not loaded yet', () => {
		const target = {
			ref: { path: 'x.java', fn: 2 },
			file: 0,
			label: 'X.f',
			isAsync: false,
			springAsync: false
		};
		const scene = layoutChart(
			chart([s('x.f()', [0])], [call('x.f', { kind: 'target', targets: [target], reason: null })]),
			input(),
			'e0'
		);
		expect(scene.missing).toEqual([target.ref]);
	});

	it('groups consecutive call-free statements into one box', () => {
		const scene = layoutChart(chart([s('a = 1'), s('b = 2'), s('c = 3')]), input());
		const group = scene.shapes.find((x) => x.type === 'box' && x.kind === 'group') as {
			lines: string[];
		};
		expect(group.lines).toEqual(['a = 1', 'b = 2', 'c = 3']);
	});
});

describe('wrap', () => {
	it('breaks on spaces, splits a single over-long token, and caps lines with …', () => {
		expect(wrap('aaa bbb ccc', 20 + 7 * 8)).toEqual(['aaa bbb', 'ccc']);
		const token = 'x'.repeat(30);
		expect(wrap(token, 20 + 7 * 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(10)]);
		const capped = wrap('a b c d e f g h i j k l', 20 + 7 * 8, 2);
		expect(capped).toHaveLength(2);
		expect(capped[1].endsWith('…')).toBe(true);
	});
});

describe('fitTransform', () => {
	it('centres a chart that fits at 100%', () => {
		expect(fitTransform(400, 300, 1000, 800, 24)).toEqual({ k: 1, x: 300, y: 250, clamped: false });
	});

	it('scales a bigger chart down to fit both dimensions', () => {
		const wide = fitTransform(2000, 100, 1048, 800, 24);
		expect(wide.k).toBeCloseTo(0.5);
		expect(wide.x).toBeCloseTo(24);
		const tall = fitTransform(100, 3104, 1000, 1600, 24);
		expect(tall.k).toBeCloseTo(0.5);
		expect(tall.y).toBeCloseTo(24);
	});

	it('never enlarges past 100%', () => {
		expect(fitTransform(10, 10, 5000, 5000).k).toBe(1);
	});

	it('stops short at the zoom limit, anchored top-left, when the chart is too big', () => {
		expect(fitTransform(1e6, 1e6, 500, 500, 24)).toEqual({
			k: ZOOM_MIN,
			x: 24,
			y: 24,
			clamped: true
		});
	});
});

describe('clampZoom', () => {
	it('keeps zoom within its limits', () => {
		expect(clampZoom(0.01)).toBe(ZOOM_MIN);
		expect(clampZoom(99)).toBe(ZOOM_MAX);
		expect(clampZoom(1.5)).toBe(1.5);
	});
});

describe('startTransform', () => {
	it('shows a narrow tall chart at 100% from its top', () => {
		expect(startTransform(500, 5000, 1500, 900, 24)).toEqual({
			k: 1,
			x: 500,
			y: 24,
			clamped: false
		});
	});

	it('fits a wide chart to the width, from its top', () => {
		const t = startTransform(2904, 4000, 1500, 900, 24);
		expect(t.k).toBeCloseTo(0.5);
		expect(t.x).toBeCloseTo(24);
		expect(t.y).toBe(24);
		expect(t.clamped).toBe(false);
	});

	it('centres a chart that fits entirely', () => {
		expect(startTransform(400, 300, 1000, 800, 24)).toEqual({
			k: 1,
			x: 300,
			y: 250,
			clamped: false
		});
	});

	it('stops short at the zoom limit for a chart wider than it allows, anchored left', () => {
		const t = startTransform(20000, 3000, 1000, 800, 24);
		expect(t).toEqual({ k: ZOOM_MIN, x: 24, y: 24, clamped: true });
	});
});

describe('viewportRect', () => {
	it('is the stage at 100% with no offset', () => {
		expect(viewportRect({ k: 1, x: 0, y: 0 }, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
	});

	it('scales and shifts with the transform', () => {
		expect(viewportRect({ k: 2, x: -100, y: 40 }, 800, 600)).toEqual({
			x: 50,
			y: -20,
			w: 400,
			h: 300
		});
		expect(viewportRect({ k: 0.5, x: 10, y: -30 }, 800, 600)).toEqual({
			x: -20,
			y: 60,
			w: 1600,
			h: 1200
		});
	});
});

describe('minimapToTransform', () => {
	const stageW = 1200;
	const stageH = 700;
	const centreOf = (t: { k: number; x: number; y: number }) => {
		const r = viewportRect(t, stageW, stageH);
		return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
	};

	for (const k of [1, 2.5, 0.3]) {
		it(`centres the clicked chart point at zoom ${k}`, () => {
			const map = mapFrame(2000, 1600, 200, 160); // s = 0.1, no offset
			const t = minimapToTransform(50, 120, map, k, stageW, stageH);
			expect(t.k).toBe(k);
			const c = centreOf(t);
			expect(c.x).toBeCloseTo(500);
			expect(c.y).toBeCloseTo(1200);
		});
	}

	it('round-trips: the viewport is centred on the clicked point', () => {
		const map = mapFrame(3000, 9000, 200, 160); // drawn 53 wide from x = 73
		for (const [mx, my] of [
			[100, 80],
			[80, 10],
			[120, 150]
		]) {
			const t = minimapToTransform(mx, my, map, 1.7, stageW, stageH);
			const r = viewportRect(t, stageW, stageH);
			const p = { x: (mx - map.ox) / map.s, y: (my - map.oy) / map.s };
			expect(r.x + r.w / 2).toBeCloseTo(p.x);
			expect(r.y + r.h / 2).toBeCloseTo(p.y);
		}
	});

	it('accounts for the offset of a chart smaller than the map box', () => {
		// 400x1600 in 200x160: s = 0.1, drawn 40 wide, centred: ox = 80, oy = 0.
		const map = mapFrame(400, 1600, 200, 160);
		expect(map.s).toBeCloseTo(0.1);
		expect(map.ox).toBeCloseTo(80);
		expect(map.oy).toBeCloseTo(0);
		const c = centreOf(minimapToTransform(100, 80, map, 2, stageW, stageH));
		expect(c.x).toBeCloseTo(200);
		expect(c.y).toBeCloseTo(800);
		// A click in the margin goes to the nearest edge of the chart.
		const edge = centreOf(minimapToTransform(5, 80, map, 1, stageW, stageH));
		expect(edge.x).toBeCloseTo(0);
	});
});

describe('findMatches', () => {
	const scene = layoutChart(
		chart(
			[
				s('a = 1'),
				s('b = 2'),
				s('c = 3'),
				s('d = 4'),
				s('hidden = 5'),
				{
					kind: 'if',
					line: 2,
					cond: part('page < 1'),
					then: [s('model.addAttribute("page", 1)', [0])],
					else: null
				},
				s('return model.addAttribute("x")', [1])
			],
			[call('model.addAttribute'), call('model.addAttribute')]
		),
		input()
	);

	it('finds statements, call names and conditions, case-insensitively', () => {
		const ids = findMatches(scene, 'ADDATTRIBUTE');
		expect(ids.length).toBe(2);
		expect(findMatches(scene, 'page < 1').length).toBe(1);
		expect(findMatches(scene, 'ctl.handle').length).toBe(1); // the frame title
	});

	it('lists matches top to bottom', () => {
		const ids = findMatches(scene, 'addAttribute');
		const y = (id: string) => scene.shapes.find((x) => x.id === id)!;
		expect((y(ids[0]) as Rect).y).toBeLessThan((y(ids[1]) as Rect).y);
	});

	it('finds text in a group beyond the lines it lists', () => {
		expect(findMatches(scene, 'hidden').length).toBe(1);
	});

	it('finds nothing for an empty query', () => {
		expect(findMatches(scene, '  ')).toEqual([]);
	});
});

describe('closedSummary', () => {
	it('counts open calls and closed ones by reason', () => {
		const target = (n: number) => ({ path: 'b.java', fn: n });
		const t = (n: number) => ({
			ref: target(n),
			file: 0,
			label: `f${n}`,
			isAsync: false,
			springAsync: false
		});
		const scene = layoutChart(
			chart(
				[s('x()', [0]), s('y()', [1]), s('z()', [2]), s('self()', [3])],
				[
					call('lib'),
					call('x', { kind: 'target', targets: [t(1)] }),
					call('y', { kind: 'target', targets: [t(2)] }),
					call('self', { kind: 'target', targets: [{ ...t(0), ref: { path: 'a.java', fn: 0 } }] })
				]
			),
			input(
				{
					'b.java#1': chart([], [], { ref: target(1) }),
					'b.java#2': chart([], [], { ref: target(2) })
				},
				{ 'root/2': false }
			),
			'root'
		);
		const chips = scene.shapes.flatMap((x) => (x.type === 'box' ? x.calls : []));
		expect(closedSummary(chips)).toEqual({
			opened: 1,
			byHand: 1,
			unresolved: 1,
			depth: 0,
			recursive: 1
		});
	});
});

describe('closedWords', () => {
	it('names only the reasons that occur', () => {
		expect(closedWords({ opened: 12, byHand: 0, unresolved: 9, depth: 2, recursive: 1 })).toBe(
			'Opened 12 calls · 9 not resolved · 2 at the depth limit · 1 recursive'
		);
		expect(closedWords({ opened: 1, byHand: 1, unresolved: 0, depth: 0, recursive: 0 })).toBe(
			'Opened 1 call · 1 closed by hand'
		);
	});
});
