/**
 * Blast radius (repograph-spec.md §7): every node transitively reachable from `start`.
 * Over `adj` that is what `start` depends on; over `rev`, everything a change to
 * `start` can affect. `start` itself is only included if it sits on a cycle.
 */
export function bfsReach(adjacency: number[][], start: number): Set<number> {
	const reached = new Set<number>();
	const queue = [start];
	for (let head = 0; head < queue.length; head++) {
		for (const w of adjacency[queue[head]]) {
			if (reached.has(w)) continue;
			reached.add(w);
			queue.push(w);
		}
	}
	return reached;
}
