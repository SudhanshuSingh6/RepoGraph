import { error } from '@sveltejs/kit';
import { IMPORT_MAX_BYTES } from '$app/env/private';
import { requireUser } from '#lib/server/auth/guards.ts';
import { sampleArchive } from '#lib/server/sampleArchive.ts';
import { insertProject, saveUpload } from '#lib/server/db/projects.ts';
import { withTransaction } from '#lib/server/db/transaction.ts';
import { enqueueParseJob } from '#lib/server/jobs.ts';
import { isValidBranch, parseGithubUrl } from '#lib/import/github.ts';
import type { RequestHandler } from './$types';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const MULTIPART_OVERHEAD = 64 * 1024;

type NewProject =
	| { source: 'github'; name: string; owner: string; repo: string; branch: string | null }
	| { source: 'upload'; name: string; archive: Uint8Array };

/**
 * Creates a project and queues its import. Body is one of
 *   JSON { github: "owner/repo or URL", branch?: string }
 *   JSON { sample: true }                      — the built-in sample project
 *   multipart form { archive: <.zip>, name?: string }
 * Returns immediately — the worker does the clone/extract/parse.
 *
 * GitHub and sample imports work signed out: the code is public, so the project is
 * created without an owner and anyone with its link can open it (the clone runs with
 * no credentials, so a private repo simply fails). Uploads may be private code and
 * require signing in. Signed-in imports of any kind stay owned and private.
 */
export const POST: RequestHandler = async (event) => {
	// Checked before reading the body, so an anonymous upload is refused unread.
	const isUpload = (event.request.headers.get('content-type') ?? '').startsWith('multipart/');
	const user = isUpload ? requireUser(event) : event.locals.user;
	const input = await readInput(event.request);

	// Project row + job row (+ upload) in ONE transaction: either all exist or none do.
	const id = await withTransaction(async (tx) => {
		const projectId = await insertProject(tx, {
			ownerId: user?.id ?? null,
			name: input.name,
			source: input.source,
			...(input.source === 'github'
				? { githubOwner: input.owner, githubRepo: input.repo, githubBranch: input.branch }
				: {})
		});
		if (input.source === 'upload') await saveUpload(tx, projectId, input.archive);
		await enqueueParseJob(projectId, tx);
		return projectId;
	});

	return Response.json({ id }, { status: 201 });
};

async function readInput(request: Request): Promise<NewProject> {
	const type = request.headers.get('content-type') ?? '';

	if (type.startsWith('application/json')) {
		const body = await request.json().catch(() => null);
		if (body?.sample === true) {
			return { source: 'upload', name: 'sample-project', archive: await sampleArchive() };
		}
		const ref = typeof body?.github === 'string' ? parseGithubUrl(body.github) : null;
		if (!ref) error(400, 'Enter a GitHub repository like owner/repo or a github.com URL.');
		const branch =
			typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : ref.branch;
		if (branch !== null && !isValidBranch(branch)) error(400, 'That branch name is not valid.');
		return { source: 'github', name: ref.repo, owner: ref.owner, repo: ref.repo, branch };
	}

	if (type.startsWith('multipart/form-data')) {
		const declared = Number(request.headers.get('content-length') ?? 0);
		if (declared > IMPORT_MAX_BYTES + MULTIPART_OVERHEAD) error(413, tooLarge());
		const form = await request.formData().catch(() => null);
		const file = form?.get('archive');
		if (!(file instanceof File)) error(400, 'Attach the project as a .zip file.');
		if (file.size > IMPORT_MAX_BYTES) error(413, tooLarge());
		const archive = new Uint8Array(await file.arrayBuffer());
		if (!ZIP_MAGIC.every((b, i) => archive[i] === b))
			error(400, 'That file is not a .zip archive.');
		const rawName = form?.get('name');
		return {
			source: 'upload',
			name: projectName(typeof rawName === 'string' ? rawName : file.name),
			archive
		};
	}

	error(415, 'Send JSON (GitHub or sample import) or multipart/form-data (upload).');
}

function projectName(raw: string): string {
	const name = raw
		.replace(/\.zip$/i, '')
		.replace(/\p{Cc}/gu, '')
		.trim()
		.slice(0, 200);
	return name || 'Uploaded project';
}

function tooLarge(): string {
	return `Projects can be at most ${Math.floor(IMPORT_MAX_BYTES / (1024 * 1024))}MB.`;
}
