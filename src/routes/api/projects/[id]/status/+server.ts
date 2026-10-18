import { requireProjectOwner } from '#lib/server/auth/guards.ts';
import { getProjectSummary } from '#lib/server/db/projects.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const project = await requireProjectOwner(event, event.params.id);
	return Response.json({
		id: project.id,
		name: project.name,
		source: project.source,
		github:
			project.source === 'github'
				? { owner: project.githubOwner, repo: project.githubRepo, branch: project.githubBranch }
				: null,
		status: project.status,
		errorMessage: project.errorMessage,
		skippedLargeFiles: project.skippedLargeFiles,
		summary: project.status === 'ready' ? await getProjectSummary(project.id) : null
	});
};
