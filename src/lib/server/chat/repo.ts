// What chat sees: the whole, unfiltered project (repograph-spec.md §17), derived once
// per import and cached like the graph payload.
import { analyze, type Derived, type Graph } from '#analysis/graph/index.ts';
import { getProjectGraph } from '#lib/server/db/graph.ts';
import { cached } from '#lib/server/graphCache.ts';
import type { Project } from '#lib/server/db/projects.ts';

export type ChatRepo = {
	projectId: string;
	name: string;
	graph: Graph;
	derived: Derived;
	byPath: Map<string, number>;
};

export function getChatRepo(project: Project & { parsedAt: Date }): Promise<ChatRepo> {
	return cached(`${project.id}:chat`, project.parsedAt.toISOString(), async () => {
		const graph = await getProjectGraph(project.id);
		const { derived } = analyze(graph, project.name);
		return {
			projectId: project.id,
			name: project.name,
			graph,
			derived,
			byPath: new Map(graph.files.map((f, i) => [f.path, i]))
		};
	});
}
