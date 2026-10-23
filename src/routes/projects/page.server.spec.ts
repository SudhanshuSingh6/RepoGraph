import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const listProjects = vi.fn();
const deleteProject = vi.fn();
vi.mock('#lib/server/db/projects.ts', () => ({ listProjects, deleteProject }));

const { load, actions } = await import('./+page.server');

const alice = { id: 'u-alice', githubId: '1', username: 'alice', avatarUrl: null };
const ID = '0b5b2c3e-6a77-4b39-9f0e-2c1d2f3a4b5c';

function del(projectId: string | null, user: typeof alice | null = alice) {
	const form = new FormData();
	if (projectId !== null) form.append('projectId', projectId);
	const request = new Request('http://localhost/projects?/delete', { method: 'POST', body: form });
	return Promise.resolve(actions.delete({ request, locals: { user } } as never)).catch(
		(e: unknown) => e
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	listProjects.mockResolvedValue([{ id: ID, name: 'demo', files: 3 }]);
	deleteProject.mockResolvedValue(true);
});

describe('/projects load', () => {
	it("lists the signed-in user's projects", async () => {
		const data = await load({ locals: { user: alice } } as never);
		expect(listProjects).toHaveBeenCalledWith('u-alice');
		expect(data).toEqual({ projects: [{ id: ID, name: 'demo', files: 3 }] });
	});

	it('has no list when signed out', async () => {
		expect(await load({ locals: { user: null } } as never)).toEqual({ projects: null });
		expect(listProjects).not.toHaveBeenCalled();
	});
});

describe('/projects delete', () => {
	it("deletes only as the signed-in owner's project", async () => {
		expect(await del(ID)).toEqual({ deleted: ID });
		expect(deleteProject).toHaveBeenCalledWith(ID, 'u-alice');
	});

	it("is a 404 for someone else's project, a missing one or no id", async () => {
		deleteProject.mockResolvedValue(false);
		expect(isHttpError(await del(ID), 404)).toBe(true);
		expect(isHttpError(await del(null), 404)).toBe(true);
	});

	it('is a 401 when signed out', async () => {
		expect(isHttpError(await del(ID, null), 401)).toBe(true);
		expect(deleteProject).not.toHaveBeenCalled();
	});
});
