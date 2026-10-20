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
 * project. Public projects (no owner: a public GitHub repo or the sample, imported
 * without signing in) are open to anyone with the link. An owned project is only for
 * its owner; to anyone else it is reported as not found, so IDs can't be probed.
 */
export async function requireProjectAccess(
	event: Pick<RequestEvent, 'locals'>,
	projectId: string
): Promise<Project> {
	const project = await getProject(projectId);
	if (!project) error(404, 'Project not found.');
	if (project.ownerId === null) return project;
	const user = requireUser(event);
	if (project.ownerId !== user.id) error(404, 'Project not found.');
	return project;
}
