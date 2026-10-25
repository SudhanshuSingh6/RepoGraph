import { error } from '@sveltejs/kit';
import { getApisModel } from '#lib/server/apis/model.ts';
import { requireProjectAccess } from '#lib/server/auth/guards.ts';
import { cached } from '#lib/server/graphCache.ts';
import type { RequestHandler } from './$types';

/** The APIs view: every detected endpoint over the whole, unfiltered repo, with file
 * indexes lined up with `/graph`'s and per-endpoint flow counts. Raw per-function facts
 * never leave the server; a flow is fetched per endpoint from `./[n]/flow`. */
export const GET: RequestHandler = async (event) => {
	const project = await requireProjectAccess(event, event.params.id);
	if (project.status !== 'ready' || !project.parsedAt) {
		error(409, 'This project has not finished importing yet.');
	}
	const parsedAt = project.parsedAt;
	const body = await cached(`${project.id}:apis`, parsedAt.toISOString(), async () => {
		const { endpoints, hasFlowData } = await getApisModel({ ...project, parsedAt });
		return JSON.stringify({ endpoints, hasFlowData });
	});
	return new Response(body, { headers: { 'content-type': 'application/json' } });
};
