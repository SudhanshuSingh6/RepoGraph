import type { Derived, Graph, Lang } from './types.ts';

export type TreeNode = {
	name: string; // display label; a collapsed chain reads `src/main/java`
	path: string; // full path from the repo root ('' for the root)
	file?: number; // index into Graph.files, for file nodes
	children?: TreeNode[]; // folder nodes only: folders first, then files, by name
	loc: number;
	files: number;
	lang: Lang; // dominant language, by lines
	langLoc: Partial<Record<Lang, number>>;
	maxFanIn: number;
	maxFanOut: number;
	cycleFiles: number;
};

type Draft = { name: string; path: string; file?: number; children?: Map<string, Draft> };

/**
 * The path hierarchy behind the Tree and Size-map views (repograph-spec.md §7), over
 * the active files only. Like a compressed trie, a folder whose only child is another
 * folder merges with it (`src` → `main` → `java` becomes one `src/main/java` node).
 * Every node aggregates its subtree: lines, file count, dominant language, max
 * fan-in/out among descendants and the number of files on an import cycle.
 */
export function buildTree(graph: Graph, derived: Derived, rootName = ''): TreeNode {
	const root: Draft = { name: rootName, path: '', children: new Map() };
	graph.files.forEach((f, i) => {
		if (!derived.active[i]) return;
		const parts = f.path.split('/');
		let node = root;
		for (let d = 0; d < parts.length - 1; d++) {
			let child = node.children!.get(parts[d] + '/');
			if (!child) {
				child = { name: parts[d], path: parts.slice(0, d + 1).join('/'), children: new Map() };
				node.children!.set(parts[d] + '/', child);
			}
			node = child;
		}
		node.children!.set(parts[parts.length - 1], {
			name: parts[parts.length - 1],
			path: f.path,
			file: i
		});
	});
	return finish(root, graph, derived, true);
}

function finish(draft: Draft, graph: Graph, derived: Derived, isRoot = false): TreeNode {
	if (draft.file !== undefined) {
		const i = draft.file;
		const f = graph.files[i];
		return {
			name: draft.name,
			path: draft.path,
			file: i,
			loc: f.loc,
			files: 1,
			lang: f.lang,
			langLoc: { [f.lang]: f.loc },
			maxFanIn: derived.fanIn[i],
			maxFanOut: derived.fanOut[i],
			cycleFiles: derived.inCycle[i] ? 1 : 0
		};
	}
	let node = draft;
	let name = draft.name;
	if (!isRoot) {
		while (node.children!.size === 1) {
			const only = node.children!.values().next().value!;
			if (only.file !== undefined) break;
			node = only;
			name = `${name}/${only.name}`;
		}
	}
	const children = [...node.children!.values()]
		.sort(
			(a, b) =>
				Number(a.file !== undefined) - Number(b.file !== undefined) ||
				(a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
		)
		.map((c) => finish(c, graph, derived));

	const langLoc: Partial<Record<Lang, number>> = {};
	let loc = 0,
		files = 0,
		maxFanIn = 0,
		maxFanOut = 0,
		cycleFiles = 0;
	for (const c of children) {
		loc += c.loc;
		files += c.files;
		maxFanIn = Math.max(maxFanIn, c.maxFanIn);
		maxFanOut = Math.max(maxFanOut, c.maxFanOut);
		cycleFiles += c.cycleFiles;
		for (const [l, n] of Object.entries(c.langLoc) as [Lang, number][]) {
			langLoc[l] = (langLoc[l] ?? 0) + n;
		}
	}
	return {
		name,
		path: node.path,
		children,
		loc,
		files,
		lang: dominant(langLoc),
		langLoc,
		maxFanIn,
		maxFanOut,
		cycleFiles
	};
}

function dominant(langLoc: Partial<Record<Lang, number>>): Lang {
	let best: Lang = 'ts';
	let most = -1;
	for (const l of ['java', 'js', 'ts', 'py'] as const) {
		const n = langLoc[l];
		if (n !== undefined && n > most) [best, most] = [l, n];
	}
	return best;
}
