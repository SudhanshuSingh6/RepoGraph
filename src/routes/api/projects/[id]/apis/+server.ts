import { error } from '@sveltejs/kit';
import { toEndpoints } from '#analysis/apis/index.ts';
import { requireProjectAccess } from '#lib/server/auth/guards.ts';
import { getProjectEndpoints } from '#lib/server/db/flows.ts';
import { getProjectGraph } from '#lib/server/db/graph.ts';
import { cached } from '#lib/server/graphCache.ts';
import type { RequestHandler } from './$types';

/** The APIs view: every detected endpoint over the whole, unfiltered repo, with file
 * indexes lined up with `/graph`'s. Raw per-function facts never leave the server. */
export const GET: RequestHandler = async (event) => {
	const project = await requireProjectAccess(event, event.params.id);
	if (project.status !== 'ready' || !project.parsedAt) {
		error(409, 'This project has not finished importing yet.');
	}
	const body = await cached(`${project.id}:apis`, project.parsedAt.toISOString(), async () => {
		const [{ files }, { rows, hasFlowData }] = await Promise.all([
			getProjectGraph(project.id),
			getProjectEndpoints(project.id)
		]);
		return JSON.stringify({ endpoints: toEndpoints(rows, files), hasFlowData });
	});
	return new Response(body, { headers: { 'content-type': 'application/json' } });
};
