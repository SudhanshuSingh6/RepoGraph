import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import JSZip from 'jszip';

const insertProject = vi.fn();
const saveUpload = vi.fn();
const enqueueParseJob = vi.fn();
const tx = { tx: true };

vi.mock('$app/env/private', () => ({ IMPORT_MAX_BYTES: 1024 }));
vi.mock('#lib/server/db/projects.ts', () => ({ insertProject, saveUpload }));
vi.mock('#lib/server/jobs.ts', () => ({ enqueueParseJob }));
vi.mock('#lib/server/db/transaction.ts', () => ({
	withTransaction: (fn: (t: unknown) => unknown) => fn(tx)
}));

const { POST } = await import('./+server');

const user = { id: 'u1', githubId: '1', username: 'me', avatarUrl: null };
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

function json(body: unknown) {
	return new Request('http://localhost/api/projects', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function upload(bytes: Uint8Array<ArrayBuffer>, name?: string) {
	const form = new FormData();
	form.append('archive', new Blob([bytes]), 'my-app.zip');
	if (name) form.append('name', name);
	return new Request('http://localhost/api/projects', { method: 'POST', body: form });
}

async function call(request: Request, u: typeof user | null = user) {
	try {
		return await POST({ request, locals: { user: u } } as never);
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	insertProject.mockResolvedValue('p-new');
});

describe('POST /api/projects', () => {
	it('requires sign-in for uploads, refused before the body is read', async () => {
		const req = upload(ZIP);
		expect(isHttpError(await call(req, null), 401)).toBe(true);
		expect(req.bodyUsed).toBe(false);
		expect(insertProject).not.toHaveBeenCalled();
	});

	it('imports a public GitHub repo signed out, as an ownerless project', async () => {
		const res = (await call(json({ github: 'o/r' }), null)) as Response;
		expect(res.status).toBe(201);
		expect(insertProject.mock.calls[0][1]).toMatchObject({ ownerId: null, source: 'github' });
		expect(enqueueParseJob).toHaveBeenCalledWith('p-new', tx);
	});

	it('imports the sample project signed out, zipped on the server', async () => {
		const res = (await call(json({ sample: true }), null)) as Response;
		expect(res.status).toBe(201);
		expect(insertProject.mock.calls[0][1]).toEqual({
			ownerId: null,
			name: 'sample-project',
			source: 'upload'
		});
		const archive: Uint8Array = saveUpload.mock.calls[0][2];
		expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		const zip = await JSZip.loadAsync(archive);
		expect(zip.file('sample-project/web/src/state/store.ts')).not.toBeNull();
		expect(Object.values(zip.files).filter((f) => !f.dir)).toHaveLength(18); // 17 + README
	});

	it('keeps imports made while signed in owned', async () => {
		await call(json({ sample: true }));
		expect(insertProject.mock.calls[0][1].ownerId).toBe('u1');
	});

	it('creates a GitHub project and queues it in the same transaction', async () => {
		const res = (await call(json({ github: 'https://github.com/o/r/tree/dev' }))) as Response;
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ id: 'p-new' });
		expect(insertProject).toHaveBeenCalledWith(tx, {
			ownerId: 'u1',
			name: 'r',
			source: 'github',
			githubOwner: 'o',
			githubRepo: 'r',
			githubBranch: 'dev'
		});
		expect(enqueueParseJob).toHaveBeenCalledWith('p-new', tx);
	});

	it('an explicit branch overrides the URL branch', async () => {
		await call(json({ github: 'o/r/tree/dev', branch: 'release' }));
		expect(insertProject.mock.calls[0][1].githubBranch).toBe('release');
	});

	it.each([{ github: 'not a repo' }, { github: 'o/r', branch: '--upload-pack=x' }, {}])(
		'rejects %j with 400',
		async (body) => {
			expect(isHttpError(await call(json(body)), 400)).toBe(true);
			expect(insertProject).not.toHaveBeenCalled();
		}
	);

	it('stores an upload and queues it in the same transaction', async () => {
		const res = (await call(upload(ZIP, 'My App'))) as Response;
		expect(res.status).toBe(201);
		expect(insertProject.mock.calls[0][1]).toEqual({
			ownerId: 'u1',
			name: 'My App',
			source: 'upload'
		});
		expect(saveUpload).toHaveBeenCalledWith(tx, 'p-new', ZIP);
		expect(enqueueParseJob).toHaveBeenCalledWith('p-new', tx);
	});

	it('names an upload after the file when no name is sent', async () => {
		await call(upload(ZIP));
		expect(insertProject.mock.calls[0][1].name).toBe('my-app');
	});

	it('rejects a non-zip upload', async () => {
		expect(isHttpError(await call(upload(new Uint8Array([1, 2, 3, 4]))), 400)).toBe(true);
	});

	it('rejects an upload over IMPORT_MAX_BYTES with 413', async () => {
		const big = new Uint8Array(2048);
		big.set(ZIP);
		expect(isHttpError(await call(upload(big)), 413)).toBe(true);
		expect(saveUpload).not.toHaveBeenCalled();
	});

	it('rejects other content types with 415', async () => {
		const req = new Request('http://localhost/api/projects', { method: 'POST', body: 'x' });
		expect(isHttpError(await call(req), 415)).toBe(true);
	});
});
