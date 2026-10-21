import {
	UNGROUPED,
	bfsReach,
	groupOf,
	type Derived,
	type FileNode,
	type Lang
} from '#analysis/graph/index.ts';
import { LANGS } from '#lib/workspace/langs.ts';

/** A circle in the Dependencies view: one file, or a folder group at the Detail level. */
export type GraphNode = {
	id: string; // the file path, or the group's folder path
	label: string;
	files: number[]; // member file indexes
	loc: number;
	lang: Lang; // dominant, by lines
	inCycle: boolean; // any member file is on an import cycle
	cluster: string; // the folder `forceCluster` pulls it toward its neighbours in
};

/** File imports between two different nodes, merged into one arrow. */
export type GraphLink = {
	id: string;
	source: string;
	target: string;
	count: number; // underlying file → file imports
	cycle: boolean; // at least one of them runs between files of the same cycle
};

export type GraphModel = { nodes: GraphNode[]; links: GraphLink[]; level: number };

export type GraphOptions = { hideUnconnected: boolean; onlyCycles: boolean };

function parentFolder(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

/**
 * The Dependencies view's nodes and arrows (repograph-spec.md §10) over the active
 * files, grouped at `level`. Merged links are for drawing and hovering only — never
 * traverse them (see `blastGroups`): a folder → folder path need not follow any real
 * chain of file imports.
 */
export function buildGraphModel(
	files: FileNode[],
	derived: Derived,
	level: number,
	opts: GraphOptions
): GraphModel {
	const sccOf = new Map<number, number>();
	derived.cycles.forEach((group, k) => group.forEach((i) => sccOf.set(i, k)));

	const byId = new Map<string, GraphNode>();
	const langLoc = new Map<string, Map<Lang, number>>();
	files.forEach((f, i) => {
		if (!derived.active[i]) return;
		const id = groupOf(f.path, level);
		let node = byId.get(id);
		if (!node) {
			const grouped = level !== UNGROUPED && id !== f.path;
			node = {
				id,
				label: grouped ? id : f.path.slice(f.path.lastIndexOf('/') + 1),
				files: [],
				loc: 0,
				lang: f.lang,
				inCycle: false,
				cluster: parentFolder(id)
			};
			byId.set(id, node);
			langLoc.set(id, new Map());
		}
		node.files.push(i);
		node.loc += f.loc;
		node.inCycle ||= derived.inCycle[i];
		const ll = langLoc.get(id)!;
		ll.set(f.lang, (ll.get(f.lang) ?? 0) + f.loc);
	});
	for (const [id, ll] of langLoc) {
		let best = -1;
		for (const l of LANGS) {
			const n = ll.get(l);
			if (n !== undefined && n > best) [byId.get(id)!.lang, best] = [l, n];
		}
	}

	const linkById = new Map<string, GraphLink>();
	derived.adj.forEach((targets, a) => {
		for (const b of targets) {
			const source = groupOf(files[a].path, level);
			const target = groupOf(files[b].path, level);
			if (source === target) continue;
			const id = `${source}\u0000${target}`;
			let link = linkById.get(id);
			if (!link) {
				link = { id, source, target, count: 0, cycle: false };
				linkById.set(id, link);
			}
			link.count++;
			link.cycle ||= sccOf.has(a) && sccOf.get(a) === sccOf.get(b);
		}
	});

	let nodes = [...byId.values()];
	let links = [...linkById.values()];
	if (opts.onlyCycles) {
		nodes = nodes.filter((n) => n.inCycle);
		links = links.filter((l) => l.cycle);
	}
	if (opts.hideUnconnected) {
		const linked = new Set(links.flatMap((l) => [l.source, l.target]));
		nodes = nodes.filter((n) => linked.has(n.id));
	}
	return { nodes, links, level };
}

/**
 * Blast radius of a displayed node: every node holding a file that transitively
 * imports one of its files — i.e. what a change to it can affect. Traverses the
 * file-level reverse adjacency from all of the node's member files, then maps the
 * reached files back to displayed nodes.
 */
export function blastGroups(
	model: GraphModel,
	files: FileNode[],
	derived: Derived,
	nodeId: string
): Set<string> {
	const node = model.nodes.find((n) => n.id === nodeId);
	if (!node) return new Set();
	const shown = new Set(model.nodes.map((n) => n.id));
	const out = new Set<string>();
	for (const i of bfsReach(derived.rev, node.files)) {
		const id = groupOf(files[i].path, model.level);
		if (shown.has(id)) out.add(id);
	}
	return out;
}
