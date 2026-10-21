/**
 * Blast radius (repograph-spec.md §7): every node transitively reachable from `start`.
 * Over `adj` that is what `start` depends on; over `rev`, everything a change to
 * `start` can affect. `start` may be several nodes (a folder's files); a start node is
 * only included if another reached node (or itself, on a cycle) leads back to it.
 */
export function bfsReach(adjacency: number[][], start: number | number[]): Set<number> {
	const reached = new Set<number>();
	const queue = Array.isArray(start) ? [...start] : [start];
	for (let head = 0; head < queue.length; head++) {
		for (const w of adjacency[queue[head]]) {
			if (reached.has(w)) continue;
			reached.add(w);
			queue.push(w);
		}
	}
	return reached;
}
