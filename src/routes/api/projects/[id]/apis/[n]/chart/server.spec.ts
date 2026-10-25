import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const getProject = vi.fn();
const getProjectGraph = vi.fn();
const getProjectEndpoints = vi.fn();
const getProjectFunctions = vi.fn();
vi.mock('#lib/server/db/projects.ts', () => ({ getProject }));
vi.mock('#lib/server/db/graph.ts', () => ({ getProjectGraph }));
vi.mock('#lib/server/db/flows.ts', () => ({ getProjectEndpoints, getProjectFunctions }));

const { GET: endpointChart } = await import('./+server');
const { GET: fnChart } = await import('../../chart/+server');
const { clearGraphCache } = await import('#lib/server/graphCache.ts');

const alice = { id: 'u-alice', githubId: '1', username: 'alice', avatarUrl: null };
const ready = { id: 'p1', ownerId: 'u-alice', name: 'demo', status: 'ready', parsedAt: new Date() };
const FILES = ['app.py', 'svc.py'].map((path) => ({
	path,
	lang: 'py',
	loc: 1,
	isTest: false,
	isEntry: false
}));
const fn = (name: string, calls: unknown[] = []) => ({
	name,
	owner: null,
	line: 1,
	end_line: 2,
	synthetic: false,
	abstract: false,
	is_async: false,
	body: [{ kind: 'stmt', line: 1, text: `${name}()`, calls: calls.length ? [0] : [] }],
	calls
});
const callTo = (path: string, i: number) => ({
	receiver: null,
	name: 'go',
	line: 1,
	guarded: false,
	args: 0,
	new: false,
	target: { path, fn: i }
});

const ev = (params: Record<string, string>, url = 'http://x/', user: typeof alice | null = alice) =>
	({ params: { id: 'p1', ...params }, locals: { user }, url: new URL(url) }) as never;

async function call<T>(h: (e: never) => T | Promise<T>, e: never) {
	try {
		return await h(e);
	} catch (err) {
		return err;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	clearGraphCache();
	getProject.mockResolvedValue(ready);
	getProjectGraph.mockResolvedValue({ files: FILES, edges: [] });
	getProjectEndpoints.mockResolvedValue({
		rows: [
			{
				path: 'app.py',
				endpoints: [
					{
						framework: 'flask',
						method: 'GET',
						path: '/x',
						prefix: 'root',
						line: 1,
						handler: { label: 'view', path: 'app.py', fn: 0, line: 1 }
					},
					{
						framework: 'flask',
						method: 'GET',
						path: '/y',
						prefix: 'root',
						line: 2,
						handler: { label: 'gone', path: null, fn: null, line: null }
					}
				]
			}
		],
		hasFlowData: true
	});
	getProjectFunctions.mockResolvedValue([
		{ path: 'app.py', functions: [fn('view', [callTo('svc.py', 0), callTo('svc.py', 0)])] },
		{ path: 'svc.py', functions: [fn('go', [callTo('svc.py', 1)]), fn('deeper')] }
	]);
});

describe('GET /api/projects/:id/apis/:n/chart', () => {
	it('returns the handler and each direct callee once', async () => {
		const res = (await call(endpointChart, ev({ n: '0' }))) as Response;
		const body = await res.json();
		expect(body.root).toMatchObject({ label: 'view', file: 0, lang: 'py' });
		expect(body.callees.map((c: { label: string }) => c.label)).toEqual(['go']);
	});

	it('has no chart when the handler was not found', async () => {
		expect(await ((await call(endpointChart, ev({ n: '1' }))) as Response).json()).toEqual({
			root: null,
			callees: []
		});
	});

	it('is 404 for an unknown endpoint, 409 until ready, and guards access', async () => {
		expect(isHttpError(await call(endpointChart, ev({ n: '9' })), 404)).toBe(true);
		getProject.mockResolvedValueOnce({ ...ready, status: 'parsing', parsedAt: null });
		expect(isHttpError(await call(endpointChart, ev({ n: '0' })), 409)).toBe(true);
		getProject.mockResolvedValueOnce({ ...ready, ownerId: 'u-bob' });
		expect(isHttpError(await call(endpointChart, ev({ n: '0' })), 404)).toBe(true);
	});
});

describe('GET /api/projects/:id/apis/chart', () => {
	it('returns one function of this project', async () => {
		const res = (await call(fnChart, ev({}, 'http://x/?path=svc.py&fn=1'))) as Response;
		expect((await res.json()).chart).toMatchObject({
			label: 'deeper',
			ref: { path: 'svc.py', fn: 1 }
		});
	});

	it('refuses paths and indexes that are not this project’s functions', async () => {
		expect(isHttpError(await call(fnChart, ev({}, 'http://x/?path=../etc/passwd&fn=0')), 404)).toBe(
			true
		);
		expect(isHttpError(await call(fnChart, ev({}, 'http://x/?path=svc.py&fn=7')), 404)).toBe(true);
		expect(isHttpError(await call(fnChart, ev({}, 'http://x/?path=svc.py&fn=x')), 404)).toBe(true);
	});

	it('serves from the cached model', async () => {
		await call(fnChart, ev({}, 'http://x/?path=svc.py&fn=0'));
		await call(endpointChart, ev({ n: '0' }));
		expect(getProjectFunctions).toHaveBeenCalledTimes(1);
	});
});
