import { error } from '@sveltejs/kit';
import { UNGROUPED, analyze } from '#analysis/graph/index.ts';
import { requireProjectAccess } from '#lib/server/auth/guards.ts';
import { getProjectGraph } from '#lib/server/db/graph.ts';
import { cached } from '#lib/server/graphCache.ts';
import type { RequestHandler } from './$types';

/** JSON has no Infinity: the "ungrouped" level is sent as null. */
const level = (l: number) => (l === UNGROUPED ? null : l);

async function buildPayload(projectId: string, name: string): Promise<string> {
	const graph = await getProjectGraph(projectId);
	const { derived, tree, levels, defaultLevel } = analyze(graph, name);
	return JSON.stringify({
		files: graph.files,
		edges: graph.edges,
		fanIn: derived.fanIn,
		fanOut: derived.fanOut,
		cycles: derived.cycles,
		tree,
		levels: levels.map(level),
		defaultLevel: level(defaultLevel)
	});
}

/** The whole, unfiltered derived graph (repograph-spec.md §7) — computed once per import. */
export const GET: RequestHandler = async (event) => {
	const project = await requireProjectAccess(event, event.params.id);
	if (project.status !== 'ready' || !project.parsedAt) {
		error(409, 'This project has not finished importing yet.');
	}
	const body = await cached(`${project.id}:graph`, project.parsedAt.toISOString(), () =>
		buildPayload(project.id, project.name)
	);
	return new Response(body, { headers: { 'content-type': 'application/json' } });
};
