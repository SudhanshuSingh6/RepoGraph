import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getProject, type Project } from '#lib/server/db/projects.ts';
import type { User } from '#lib/server/db/users.ts';

export function requireUser(event: Pick<RequestEvent, 'locals'>): User {
	if (!event.locals.user) error(401, 'Sign in with GitHub first.');
	return event.locals.user;
}

/**
 * Every /api/projects/:id/* route (and page) goes through this before touching a
 * project. Someone else's project is reported as not found, so IDs can't be probed.
 */
export async function requireProjectOwner(
	event: Pick<RequestEvent, 'locals'>,
	projectId: string
): Promise<Project> {
	const user = requireUser(event);
	const project = await getProject(projectId);
	if (!project || project.ownerId !== user.id) error(404, 'Project not found.');
	return project;
}
