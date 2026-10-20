import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const getProject = vi.fn();
const getProjectGraph = vi.fn();
vi.mock('#lib/server/db/projects.ts', () => ({ getProject }));
vi.mock('#lib/server/db/graph.ts', () => ({ getProjectGraph }));

const { GET } = await import('./+server');
const { clearGraphCache } = await import('#lib/server/graphCache.ts');

const alice = { id: 'u-alice', githubId: '1', username: 'alice', avatarUrl: null };
const ready = {
	id: 'p1',
	ownerId: 'u-alice',
	name: 'demo',
	status: 'ready',
	parsedAt: new Date('2026-10-01T00:00:00Z')
};
// a → b → c → a, plus d → a
const GRAPH = {
	files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => ({
		path,
		lang: 'ts',
		loc: 3,
		isTest: false
	})),
	edges: [
		[0, 1],
		[1, 2],
		[2, 0],
		[3, 0]
	]
};

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
	getProjectGraph.mockResolvedValue(GRAPH);
});

describe('GET /api/projects/:id/graph', () => {
	it('returns the derived graph', async () => {
		const res = (await call()) as Response;
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.files).toHaveLength(4);
		expect(body.edges).toEqual(GRAPH.edges);
		expect(body.cycles).toEqual([[0, 1, 2]]);
		expect(body.fanIn).toEqual([2, 1, 1, 0]);
		expect(body.fanOut).toEqual([1, 1, 1, 1]);
		expect(body.tree).toMatchObject({ name: 'demo', files: 4, loc: 12, cycleFiles: 3 });
		expect(body.levels).toEqual([null]); // Infinity → null: no folders, ungrouped only
		expect(body.defaultLevel).toBeNull();
	});

	it("hides other users' projects (404) and requires sign-in (401)", async () => {
		getProject.mockResolvedValue({ ...ready, ownerId: 'u-bob' });
		expect(isHttpError(await call(), 404)).toBe(true);
		expect(isHttpError(await call(null), 401)).toBe(true);
		expect(getProjectGraph).not.toHaveBeenCalled();
	});

	it('serves a public (ownerless) project signed out', async () => {
		getProject.mockResolvedValue({ ...ready, ownerId: null });
		expect(((await call(null)) as Response).status).toBe(200);
	});

	it('is 409 until the import is ready', async () => {
		getProject.mockResolvedValue({ ...ready, status: 'parsing', parsedAt: null });
		expect(isHttpError(await call(), 409)).toBe(true);
		expect(getProjectGraph).not.toHaveBeenCalled();
	});

	it('computes once per import and serves repeats from the cache', async () => {
		await call();
		await call();
		await Promise.all([call(), call()]);
		expect(getProjectGraph).toHaveBeenCalledTimes(1);
	});

	it('recomputes after a re-import changes parsed_at', async () => {
		await call();
		getProject.mockResolvedValue({ ...ready, parsedAt: new Date('2026-10-02T00:00:00Z') });
		getProjectGraph.mockResolvedValue({ ...GRAPH, edges: [[3, 0]] });
		const body = await ((await call()) as Response).json();
		expect(getProjectGraph).toHaveBeenCalledTimes(2);
		expect(body.cycles).toEqual([]);
	});

	it('does not cache a failure', async () => {
		getProjectGraph.mockRejectedValueOnce(new Error('db down'));
		await expect(call()).resolves.toBeInstanceOf(Error);
		expect(((await call()) as Response).status).toBe(200);
	});
});
