import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const getProject = vi.fn();
vi.mock('#lib/server/db/projects.ts', () => ({ getProject }));

const { requireProjectAccess, requireUser } = await import('./guards');

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
		await expect(requireProjectAccess({ locals: { user: alice } }, 'p1')).resolves.toBe(project);
	});

	it("reports someone else's project as 404, same as a missing one", async () => {
		getProject.mockResolvedValue({ ...project, ownerId: 'u-bob' });
		const other = await thrown(() => requireProjectAccess({ locals: { user: alice } }, 'p1'));
		getProject.mockResolvedValue(null);
		const missing = await thrown(() => requireProjectAccess({ locals: { user: alice } }, 'p1'));
		expect(isHttpError(other, 404)).toBe(true);
		expect(isHttpError(missing, 404)).toBe(true);
	});

	it('requires sign-in for an owned project', async () => {
		getProject.mockResolvedValue(project);
		const e = await thrown(() => requireProjectAccess({ locals: { user: null } }, 'p1'));
		expect(isHttpError(e, 401)).toBe(true);
	});

	it('opens a public (ownerless) project to anyone, signed in or not', async () => {
		const pub = { ...project, ownerId: null };
		getProject.mockResolvedValue(pub);
		await expect(requireProjectAccess({ locals: { user: null } }, 'p1')).resolves.toBe(pub);
		await expect(requireProjectAccess({ locals: { user: alice } }, 'p1')).resolves.toBe(pub);
	});

	it('reports a missing project as 404 when signed out too', async () => {
		getProject.mockResolvedValue(null);
		const e = await thrown(() => requireProjectAccess({ locals: { user: null } }, 'p1'));
		expect(isHttpError(e, 404)).toBe(true);
	});
});
