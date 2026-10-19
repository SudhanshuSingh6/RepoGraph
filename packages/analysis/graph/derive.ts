import { tarjan } from './tarjan.ts';
import type { Derived, Graph } from './types.ts';

/**
 * Adjacency, fan-in/out and import cycles for the active files (repograph-spec.md §7).
 * `active` masks files out (language chips, "hide tests"); omitted = every file. An
 * edge counts only when both of its ends are active.
 */
export function derive(graph: Graph, active?: boolean[]): Derived {
	const n = graph.files.length;
	const on = active ?? new Array<boolean>(n).fill(true);
	const adj: number[][] = Array.from({ length: n }, () => []);
	const rev: number[][] = Array.from({ length: n }, () => []);
	const seen = new Set<number>();
	for (const [a, b] of graph.edges) {
		if (a === b || !on[a] || !on[b]) continue;
		const key = a * n + b;
		if (seen.has(key)) continue;
		seen.add(key);
		adj[a].push(b);
		rev[b].push(a);
	}
	const cycles = tarjan(adj);
	const inCycle = new Array<boolean>(n).fill(false);
	for (const group of cycles) for (const i of group) inCycle[i] = true;
	return {
		active: on,
		adj,
		rev,
		fanIn: rev.map((r) => r.length),
		fanOut: adj.map((a) => a.length),
		cycles,
		inCycle
	};
}
