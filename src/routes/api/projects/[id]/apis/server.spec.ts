import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const getProject = vi.fn();
const getProjectGraph = vi.fn();
const getProjectEndpoints = vi.fn();
const getProjectFunctions = vi.fn();
vi.mock('#lib/server/db/projects.ts', () => ({ getProject }));
vi.mock('#lib/server/db/graph.ts', () => ({ getProjectGraph }));
vi.mock('#lib/server/db/flows.ts', () => ({ getProjectEndpoints, getProjectFunctions }));

const { GET } = await import('./+server');
const { clearGraphCache } = await import('#lib/server/graphCache.ts');

const alice = { id: 'u-alice', githubId: '1', username: 'alice', avatarUrl: null };
const ready = { id: 'p1', ownerId: 'u-alice', name: 'demo', status: 'ready', parsedAt: new Date() };
const FILES = ['app.py', 'views.py'].map((path) => ({
	path,
	lang: 'py',
	loc: 1,
	isTest: false,
	isEntry: false
}));

async function call(user: typeof alice | null = alice) {
	try {
		return await GET({ params: { id: 'p1' }, locals: { user } } as never);
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	clearGraphCache();
	getProject.mockResolvedValue(ready);
	getProjectGraph.mockResolvedValue({ files: FILES, edges: [] });
	getProjectFunctions.mockResolvedValue([
		{
			path: 'views.py',
			functions: [
				{
					name: 'x',
					owner: null,
					line: 5,
					end_line: 6,
					synthetic: false,
					abstract: false,
					calls: [
						{
							receiver: null,
							name: 'y',
							line: 6,
							guarded: false,
							args: 0,
							new: false,
							target: { path: 'views.py', fn: 1 }
						}
					]
				},
				{
					name: 'y',
					owner: null,
					line: 8,
					end_line: 9,
					synthetic: false,
					abstract: false,
					calls: []
				}
			]
		}
	]);
	getProjectEndpoints.mockResolvedValue({
		rows: [
			{
				path: 'views.py',
				endpoints: [
					{
						framework: 'flask',
						method: 'GET',
						path: '/x',
						prefix: 'root',
						line: 4,
						handler: { label: 'x', path: 'views.py', fn: 0, line: 5 }
					}
				]
			}
		],
		hasFlowData: true
	});
});

describe('GET /api/projects/:id/apis', () => {
	it('serves endpoints with file indexes, and only those', async () => {
		const res = (await call()) as Response;
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			endpoints: [
				{
					file: 1,
					line: 4,
					framework: 'flask',
					method: 'GET',
					path: '/x',
					prefix: 'root',
					regex: false,
					handler: { label: 'x', file: 1, fn: 0, line: 5 },
					steps: 1,
					partial: false
				}
			],
			hasFlowData: true
		});
	});

	it('says when the project predates flow data', async () => {
		getProjectEndpoints.mockResolvedValue({ rows: [], hasFlowData: false });
		getProjectFunctions.mockResolvedValue([]);
		expect(await ((await call()) as Response).json()).toEqual({
			endpoints: [],
			hasFlowData: false
		});
	});

	it("hides other users' projects (404), needs sign-in for owned ones (401), is 409 until ready", async () => {
		getProject.mockResolvedValueOnce({ ...ready, ownerId: 'u-bob' });
		expect(isHttpError(await call(), 404)).toBe(true);
		expect(isHttpError(await call(null), 401)).toBe(true);
		getProject.mockResolvedValueOnce({ ...ready, status: 'parsing', parsedAt: null });
		expect(isHttpError(await call(), 409)).toBe(true);
		expect(getProjectEndpoints).not.toHaveBeenCalled();
	});

	it('serves a public project signed out, and caches per import', async () => {
		getProject.mockResolvedValue({ ...ready, ownerId: null });
		expect(((await call(null)) as Response).status).toBe(200);
		await call(null);
		expect(getProjectEndpoints).toHaveBeenCalledTimes(1);
		expect(getProjectFunctions).toHaveBeenCalledTimes(1);
	});
});
