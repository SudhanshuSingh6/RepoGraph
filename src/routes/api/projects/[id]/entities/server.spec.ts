import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const getProject = vi.fn();
const getProjectEntities = vi.fn();
const getProjectGraph = vi.fn();
vi.mock('#lib/server/db/projects.ts', () => ({ getProject }));
vi.mock('#lib/server/db/entities.ts', () => ({ getProjectEntities }));
vi.mock('#lib/server/db/graph.ts', () => ({ getProjectGraph }));

const { GET } = await import('./+server');
const { GET: getGraph } = await import('../graph/+server');
const { clearGraphCache } = await import('#lib/server/graphCache.ts');

const alice = { id: 'u-alice', githubId: '1', username: 'alice', avatarUrl: null };
const ready = {
	id: 'p1',
	ownerId: 'u-alice',
	name: 'demo',
	status: 'ready',
	parsedAt: new Date('2026-10-01T00:00:00Z')
};
const ENTITIES = [
	{
		file: 0,
		name: 'Order',
		table: 'orders',
		orm: 'jpa',
		fields: [{ name: 'id', type: 'Long', pk: true }],
		relations: [],
		line: 8
	},
	{
		file: 1,
		name: 'Customer',
		table: 'customers',
		orm: 'sqlalchemy',
		fields: [{ name: 'id', type: 'Integer', pk: true }],
		relations: [{ field: 'orders', kind: 'RelatedTo', target: 'Order' }],
		line: 7
	}
];

async function call(handler: (event: never) => unknown = GET, user: typeof alice | null = alice) {
	try {
		return await handler({ params: { id: 'p1' }, locals: { user } } as never);
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	clearGraphCache();
	getProject.mockResolvedValue(ready);
	getProjectEntities.mockResolvedValue(ENTITIES);
	getProjectGraph.mockResolvedValue({ files: [], edges: [] });
});

describe('GET /api/projects/:id/entities', () => {
	it('returns the entities, relationship targets unresolved', async () => {
		const res = (await call()) as Response;
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ entities: ENTITIES });
	});

	it('applies the same access rules as /graph', async () => {
		getProject.mockResolvedValue({ ...ready, ownerId: 'u-bob' });
		expect(isHttpError(await call(), 404)).toBe(true);
		expect(isHttpError(await call(GET, null), 401)).toBe(true);
		getProject.mockResolvedValue({ ...ready, ownerId: null });
		expect(((await call(GET, null)) as Response).status).toBe(200);
	});

	it('is 409 until the import is ready', async () => {
		getProject.mockResolvedValue({ ...ready, status: 'parsing', parsedAt: null });
		expect(isHttpError(await call(), 409)).toBe(true);
		expect(getProjectEntities).not.toHaveBeenCalled();
	});

	it('caches per import, separately from the graph payload', async () => {
		await call();
		await call();
		const graph = await ((await call(getGraph)) as Response).json();
		expect(graph.files).toEqual([]); // not the cached entities body
		expect(getProjectEntities).toHaveBeenCalledTimes(1);
		expect(getProjectGraph).toHaveBeenCalledTimes(1);
	});
});
