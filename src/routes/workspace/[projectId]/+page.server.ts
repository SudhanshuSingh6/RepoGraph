import { isHttpError, redirect } from '@sveltejs/kit';
import { requireProjectAccess } from '#lib/server/auth/guards.ts';
import { getProjectSummary } from '#lib/server/db/projects.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const project = await requireProjectAccess(event, event.params.projectId).catch((e) => {
		// The owner of a private project, signed out (e.g. an expired session).
		if (isHttpError(e, 401)) redirect(303, '/auth/github');
		throw e;
	});
	return {
		project: {
			id: project.id,
			name: project.name,
			source: project.source,
			github:
				project.source === 'github'
					? { owner: project.githubOwner, repo: project.githubRepo, branch: project.githubBranch }
					: null,
			status: project.status,
			errorMessage: project.errorMessage,
			skippedLargeFiles: project.skippedLargeFiles
		},
		summary: project.status === 'ready' ? await getProjectSummary(project.id) : null
	};
};
