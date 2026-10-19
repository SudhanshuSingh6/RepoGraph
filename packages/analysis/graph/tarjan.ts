/**
 * Tarjan's strongly-connected components (repograph-spec.md §7) — iterative, not
 * recursive, so a long import chain in a large repo can't overflow the call stack.
 *
 * Returns only the import cycles: SCCs with more than one member, largest first
 * (ties: by lowest member index), each group's members in ascending order.
 */
export function tarjan(adj: number[][]): number[][] {
	const n = adj.length;
	const index = new Int32Array(n).fill(-1);
	const low = new Int32Array(n);
	const onStack = new Uint8Array(n);
	const stack: number[] = [];
	const cycles: number[][] = [];
	let next = 0;

	for (let root = 0; root < n; root++) {
		if (index[root] !== -1) continue;
		// Explicit call stack of [node, position in its neighbour list].
		const work: [number, number][] = [[root, 0]];
		index[root] = low[root] = next++;
		stack.push(root);
		onStack[root] = 1;

		while (work.length) {
			const frame = work[work.length - 1];
			const v = frame[0];
			const nbrs = adj[v];
			if (frame[1] < nbrs.length) {
				const w = nbrs[frame[1]++];
				if (index[w] === -1) {
					index[w] = low[w] = next++;
					stack.push(w);
					onStack[w] = 1;
					work.push([w, 0]);
				} else if (onStack[w]) {
					low[v] = Math.min(low[v], index[w]);
				}
				continue;
			}
			work.pop();
			if (low[v] === index[v]) {
				const group: number[] = [];
				let w: number;
				do {
					w = stack.pop()!;
					onStack[w] = 0;
					group.push(w);
				} while (w !== v);
				if (group.length > 1) cycles.push(group.sort((a, b) => a - b));
			}
			if (work.length) {
				const u = work[work.length - 1][0];
				low[u] = Math.min(low[u], low[v]);
			}
		}
	}
	return cycles.sort((a, b) => b.length - a.length || a[0] - b[0]);
}
