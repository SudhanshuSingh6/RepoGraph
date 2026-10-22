import { error } from '@sveltejs/kit';
import { requireProjectAccess } from '#lib/server/auth/guards.ts';
import { getProjectEntities } from '#lib/server/db/entities.ts';
import { cached } from '#lib/server/graphCache.ts';
import type { RequestHandler } from './$types';

/** Every ORM entity (repograph-spec.md §12), relationship targets unresolved. */
export const GET: RequestHandler = async (event) => {
	const project = await requireProjectAccess(event, event.params.id);
	if (project.status !== 'ready' || !project.parsedAt) {
		error(409, 'This project has not finished importing yet.');
	}
	const body = await cached(`${project.id}:entities`, project.parsedAt.toISOString(), async () =>
		JSON.stringify({ entities: await getProjectEntities(project.id) })
	);
	return new Response(body, { headers: { 'content-type': 'application/json' } });
};
