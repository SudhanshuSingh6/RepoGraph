// Pure graph analysis (repograph-spec.md §7). No SvelteKit, database or DOM imports:
// the server runs it once per import (the unfiltered result chat uses), the browser
// re-runs it on every filter change, and it can move behind a service boundary later.
export type { Derived, Edge, FileNode, Graph, Lang } from './types.ts';
export type { TreeNode } from './tree.ts';
export { derive } from './derive.ts';
export { tarjan } from './tarjan.ts';
export { bfsReach } from './bfs.ts';
export { buildTree } from './tree.ts';
export {
	UNGROUPED,
	defaultGroupLevel,
	detailedLevelWithin,
	groupCount,
	groupLevels,
	groupOf
} from './levels.ts';
import { derive } from './derive.ts';
import { buildTree } from './tree.ts';
import { defaultGroupLevel, groupLevels } from './levels.ts';
import type { Graph } from './types.ts';

/** Everything derived from a whole, unfiltered graph in one call. */
export function analyze(graph: Graph, rootName = '') {
	const derived = derive(graph);
	return {
		derived,
		tree: buildTree(graph, derived, rootName),
		levels: groupLevels(graph.files),
		defaultLevel: defaultGroupLevel(graph.files)
	};
}
