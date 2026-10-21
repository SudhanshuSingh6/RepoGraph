import { error } from '@sveltejs/kit';
import { requireProjectAccess } from '#lib/server/auth/guards.ts';
import { getProjectTypes } from '#lib/server/db/types.ts';
import { cached } from '#lib/server/graphCache.ts';
import type { RequestHandler } from './$types';

/** Every class/interface declaration (repograph-spec.md §11), supertypes unresolved. */
export const GET: RequestHandler = async (event) => {
	const project = await requireProjectAccess(event, event.params.id);
	if (project.status !== 'ready' || !project.parsedAt) {
		error(409, 'This project has not finished importing yet.');
	}
	const body = await cached(`${project.id}:types`, project.parsedAt.toISOString(), async () =>
		JSON.stringify({ types: await getProjectTypes(project.id) })
	);
	return new Response(body, { headers: { 'content-type': 'application/json' } });
};
