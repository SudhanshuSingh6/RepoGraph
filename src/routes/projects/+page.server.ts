import { error } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards.ts';
import { deleteProject, listProjects } from '#lib/server/db/projects.ts';
import type { Actions, PageServerLoad } from './$types';

/** Signed out, the page asks you to sign in rather than redirecting: the OAuth callback
 * always lands on `/`. Projects imported signed out are public and owned by nobody, so
 * they never appear here. */
export const load: PageServerLoad = async ({ locals }) => ({
	projects: locals.user ? await listProjects(locals.user.id) : null
});

export const actions: Actions = {
	delete: async (event) => {
		const user = requireUser(event);
		const id = (await event.request.formData()).get('projectId');
		// Not yours, or not there: the same 404 as every other project route.
		if (typeof id !== 'string' || !(await deleteProject(id, user.id))) {
			error(404, 'Project not found.');
		}
		return { deleted: id };
	}
};
