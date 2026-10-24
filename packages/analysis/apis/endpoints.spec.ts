import { describe, expect, it } from 'vitest';
import type { FileNode } from '../graph/types.ts';
import { groupEndpoints, matchesEndpoint, toEndpoints } from './endpoints.ts';
import type { StoredEndpoint } from './types.ts';

const file = (path: string): FileNode => ({
	path,
	lang: 'ts',
	loc: 1,
	isTest: false,
	isEntry: false
});
const FILES = [file('src/orders.ts'), file('src/users.ts'), file('src/svc.ts')];

const stored = (
	method: string,
	path: string,
	over: Partial<StoredEndpoint> = {}
): StoredEndpoint => ({
	framework: 'express',
	method,
	path,
	prefix: 'resolved',
	line: 1,
	handler: { label: 'h', path: null, fn: null, line: null },
	...over
});

describe('toEndpoints', () => {
	it('maps paths to file indexes and sorts by path, then method order', () => {
		const out = toEndpoints(
			[
				{
					path: 'src/users.ts',
					endpoints: [stored('DELETE', '/api/users/:id'), stored('GET', '/api/users/:id')]
				},
				{
					path: 'src/orders.ts',
					endpoints: [
						stored('POST', '/api/orders', {
							handler: { label: 'Svc.make', path: 'src/svc.ts', fn: 0, line: 9 }
						}),
						stored('GET', '/api/orders', {
							regex: true,
							handler: { label: 'gone', path: 'src/missing.ts', fn: 0, line: 3 }
						})
					]
				},
				{ path: 'not/in/graph.ts', endpoints: [stored('GET', '/x')] }
			],
			FILES
		);
		expect(out.map((e) => `${e.method} ${e.path}`)).toEqual([
			'GET /api/orders',
			'POST /api/orders',
			'GET /api/users/:id',
			'DELETE /api/users/:id'
		]);
		expect(out[1].handler).toEqual({ label: 'Svc.make', file: 2, line: 9 });
		expect(out[0].handler).toEqual({ label: 'gone', file: null, line: null });
		expect(out[0].regex).toBe(true);
		expect(out[2].regex).toBe(false);
	});
});

describe('groupEndpoints', () => {
	const eps = toEndpoints(
		[
			{
				path: 'src/orders.ts',
				endpoints: [stored('GET', '/api/orders'), stored('GET', '/api/orders/:id')]
			},
			{ path: 'src/users.ts', endpoints: [stored('GET', '/api/users')] }
		],
		FILES
	);

	it('groups by the first segment after the shared prefix', () => {
		expect(groupEndpoints(eps, 'path', FILES).map((g) => [g.label, g.endpoints.length])).toEqual([
			['/api/orders', 2],
			['/api/users', 1]
		]);
	});

	it('groups by the first segment when nothing is shared, and the root on its own', () => {
		const mixed = toEndpoints(
			[
				{
					path: 'src/orders.ts',
					endpoints: [stored('GET', '/'), stored('GET', '/a/b'), stored('GET', '/c')]
				}
			],
			FILES
		);
		expect(groupEndpoints(mixed, 'path', FILES).map((g) => g.label)).toEqual(['/', '/a', '/c']);
	});

	it('ignores shallow paths when finding the shared prefix', () => {
		const withRoot = toEndpoints(
			[
				{
					path: 'src/orders.ts',
					endpoints: [
						stored('GET', '/'),
						stored('GET', '/api/a'),
						stored('GET', '/api/b/:id'),
						stored('GET', '/api')
					]
				}
			],
			FILES
		);
		expect(groupEndpoints(withRoot, 'path', FILES).map((g) => g.label)).toEqual([
			'/',
			'/api',
			'/api/a',
			'/api/b'
		]);
	});

	it('groups by declaring file', () => {
		expect(groupEndpoints(eps, 'file', FILES).map((g) => g.label)).toEqual([
			'src/orders.ts',
			'src/users.ts'
		]);
	});
});

describe('matchesEndpoint', () => {
	it('matches the path, the handler or the file', () => {
		const [e] = toEndpoints(
			[
				{
					path: 'src/orders.ts',
					endpoints: [
						stored('GET', '/api/x', {
							handler: { label: 'OrderCtl.list', path: null, fn: null, line: null }
						})
					]
				}
			],
			FILES
		);
		expect(matchesEndpoint(e, FILES, 'API/X')).toBe(true);
		expect(matchesEndpoint(e, FILES, 'orderctl')).toBe(true);
		expect(matchesEndpoint(e, FILES, 'orders.ts')).toBe(true);
		expect(matchesEndpoint(e, FILES, 'nope')).toBe(false);
		expect(matchesEndpoint(e, FILES, '  ')).toBe(true);
	});
});
