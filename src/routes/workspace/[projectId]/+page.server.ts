import { redirect } from '@sveltejs/kit';
import { requireProjectOwner } from '#lib/server/auth/guards.ts';
import { getProjectSummary } from '#lib/server/db/projects.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) redirect(303, '/auth/github');
	const project = await requireProjectOwner(event, event.params.projectId);
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
