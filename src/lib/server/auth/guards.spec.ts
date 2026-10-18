import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const getProject = vi.fn();
vi.mock('#lib/server/db/projects.ts', () => ({ getProject }));

const { requireProjectOwner, requireUser } = await import('./guards');

const alice = { id: 'u-alice', githubId: '1', username: 'alice', avatarUrl: null };
const project = { id: 'p1', ownerId: 'u-alice' };

async function thrown(fn: () => unknown) {
	try {
		await fn();
	} catch (e) {
		return e;
	}
	throw new Error('did not throw');
}

describe('guards', () => {
	it('requireUser rejects anonymous requests with 401', async () => {
		expect(isHttpError(await thrown(() => requireUser({ locals: { user: null } })), 401)).toBe(
			true
		);
	});

	it('returns the project to its owner', async () => {
		getProject.mockResolvedValue(project);
		await expect(requireProjectOwner({ locals: { user: alice } }, 'p1')).resolves.toBe(project);
	});

	it("reports someone else's project as 404, same as a missing one", async () => {
		getProject.mockResolvedValue({ ...project, ownerId: 'u-bob' });
		const other = await thrown(() => requireProjectOwner({ locals: { user: alice } }, 'p1'));
		getProject.mockResolvedValue(null);
		const missing = await thrown(() => requireProjectOwner({ locals: { user: alice } }, 'p1'));
		expect(isHttpError(other, 404)).toBe(true);
		expect(isHttpError(missing, 404)).toBe(true);
	});
});
