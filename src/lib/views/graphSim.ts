import type { SimulationNodeDatum } from 'd3';
import type { GraphLink, GraphNode } from './graphModel.ts';

// The Dependencies view's simulation pieces (repograph-spec.md §10), kept out of the
// component: plain, non-reactive data that the force simulation mutates every tick.

export type SimNode = GraphNode & SimulationNodeDatum & { r: number };
export type SimLink = Omit<GraphLink, 'source' | 'target'> & { source: SimNode; target: SimNode };

export type Hover = { node: string } | { link: string } | null;

/** Last known positions by node id, so a rebuilt simulation doesn't scatter the view. */
export function positionCache() {
	return new Map<string, { x: number; y: number }>();
}

/** Custom multi-foci clustering force: each tick, pulls every node toward the live
 * centroid of its own folder's nodes (the classic clustering-force pattern). */
export function forceCluster(strength: number) {
	let nodes: SimNode[] = [];
	function force(alpha: number) {
		const sums = new Map<string, { x: number; y: number; n: number }>();
		for (const d of nodes) {
			const s = sums.get(d.cluster) ?? { x: 0, y: 0, n: 0 };
			s.x += d.x!;
			s.y += d.y!;
			s.n++;
			sums.set(d.cluster, s);
		}
		const k = strength * alpha;
		for (const d of nodes) {
			const s = sums.get(d.cluster)!;
			if (s.n < 2) continue;
			d.vx! -= (d.x! - s.x / s.n) * k;
			d.vy! -= (d.y! - s.y / s.n) * k;
		}
	}
	force.initialize = (n: SimNode[]) => (nodes = n);
	return force;
}

/** A curved arrow from circle edge to circle edge. Each arrow bends to its own left, so
 * a pair of opposite imports (a two-file cycle) draws as two separate curves. */
export function edgePath(l: SimLink, bend: number): string {
	const { x: sx = 0, y: sy = 0 } = l.source;
	const { x: tx = 0, y: ty = 0 } = l.target;
	const dist = Math.hypot(tx - sx, ty - sy) || 1;
	const ux = (tx - sx) / dist;
	const uy = (ty - sy) / dist;
	const ax = sx + ux * l.source.r;
	const ay = sy + uy * l.source.r;
	const bx = tx - ux * (l.target.r + 2);
	const by = ty - uy * (l.target.r + 2);
	const cx = (ax + bx) / 2 + uy * dist * bend;
	const cy = (ay + by) / 2 - ux * dist * bend;
	return `M${ax},${ay}Q${cx},${cy} ${bx},${by}`;
}

/** What hovering traces: a node with its direct arrows and neighbours, or one arrow and
 * its two ends. Null sets when nothing is hovered. */
export function hoverFocus(
	links: SimLink[],
	hover: Hover
): { nodes: Set<string> | null; links: Set<string> | null } {
	if (hover && 'node' in hover) {
		const nodes = new Set([hover.node]);
		const ids = new Set<string>();
		for (const l of links) {
			if (l.source.id === hover.node || l.target.id === hover.node) {
				nodes.add(l.source.id).add(l.target.id);
				ids.add(l.id);
			}
		}
		return { nodes, links: ids };
	}
	if (hover && 'link' in hover) {
		const l = links.find((x) => x.id === hover.link);
		if (l) return { nodes: new Set([l.source.id, l.target.id]), links: new Set([l.id]) };
	}
	return { nodes: null, links: null };
}
