import { buildApisModel, type ApisModel } from '#analysis/apis/index.ts';
import type { StoredChartFunction } from '#analysis/apis/flowchart.ts';
import type { FileNode } from '#analysis/graph/index.ts';
import { getProjectEndpoints, getProjectFunctions } from '#lib/server/db/flows.ts';
import { getProjectGraph } from '#lib/server/db/graph.ts';
import { cached } from '#lib/server/graphCache.ts';
import type { Project } from '#lib/server/db/projects.ts';

/** Everything the APIs routes serve from, computed once per import (over the whole,
 * unfiltered repo). Only parts of it are ever sent to the browser. */
export type ApisPayload = ApisModel & {
	hasFlowData: boolean;
	files: FileNode[];
	fileIndex: Map<string, number>;
	functions: Map<string, StoredChartFunction[]>;
};

export function getApisModel(project: Project & { parsedAt: Date }): Promise<ApisPayload> {
	return cached(`${project.id}:apis-model`, project.parsedAt.toISOString(), async () => {
		const [{ files }, { rows, hasFlowData }, functionRows] = await Promise.all([
			getProjectGraph(project.id),
			getProjectEndpoints(project.id),
			getProjectFunctions(project.id)
		]);
		return {
			...buildApisModel(rows, functionRows, files),
			hasFlowData,
			files,
			fileIndex: new Map(files.map((f, i) => [f.path, i])),
			functions: new Map(
				functionRows.map((r) => [r.path, r.functions as unknown as StoredChartFunction[]])
			)
		};
	});
}
