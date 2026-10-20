import { SvelteSet } from 'svelte/reactivity';
import {
	UNGROUPED,
	buildTree,
	derive,
	type Derived,
	type Edge,
	type FileNode,
	type Graph,
	type Lang,
	type TreeNode
} from '#analysis/graph/index.ts';
import { activeMask, type LangOn } from './filters.ts';
import { LANG_NAMES } from './langs.ts';

/** GET /api/projects/:id/graph — the whole, unfiltered graph (the server's derivation
 * of it is what chat will use; the views re-derive from `files`/`edges` below). */
export type GraphPayload = {
	files: FileNode[];
	edges: Edge[];
	levels: (number | null)[]; // null = ungrouped (JSON has no Infinity)
	defaultLevel: number | null;
};

export type View = 'tree' | 'treemap' | 'graph' | 'uml' | 'er' | 'hotspots';

export type Selection = { file: number } | { folder: string } | null;

export type ColorBy = 'lang' | 'fanIn' | 'fanOut' | 'cycles';

export type Tip = { x: number; y: number; title: string; rows: [string, string][] };

/** One open project's view and filter state (the prototype's `S`). */
export class Workspace {
	readonly graph: Graph;
	readonly name: string;
	readonly levels: number[];
	readonly defaultLevel: number;

	view = $state<View>('tree');
	langOn = $state<LangOn>({});
	hideTests = $state(false);
	search = $state('');
	selection = $state<Selection>(null);
	tip = $state<Tip | null>(null);

	// Tree: expanded folder paths; the root starts open, showing the top level.
	treeExpanded = new SvelteSet<string>(['']);
	// Size map: the folder zoomed into ('' = the root) and the fill mapping.
	tmPath = $state('');
	colorBy = $state<ColorBy>('lang');

	// `refresh()` in the prototype: re-derived whenever a filter changes.
	readonly active: boolean[];
	readonly derived: Derived;
	readonly tree: TreeNode;

	constructor(payload: GraphPayload, name: string) {
		this.graph = { files: payload.files, edges: payload.edges };
		this.name = name;
		this.levels = payload.levels.map((l) => l ?? UNGROUPED);
		this.defaultLevel = payload.defaultLevel ?? UNGROUPED;
		this.active = $derived(activeMask(this.graph.files, this.langOn, this.hideTests));
		this.derived = $derived(derive(this.graph, this.active));
		this.tree = $derived(buildTree(this.graph, this.derived, this.name));
	}

	toggleLang(lang: Lang) {
		this.langOn[lang] = this.langOn[lang] === false;
	}

	isSelectedFile(i: number | undefined): boolean {
		const sel = this.selection;
		return i !== undefined && sel !== null && 'file' in sel && sel.file === i;
	}

	showTip(event: PointerEvent, title: string, rows: [string, string][]) {
		this.tip = { x: event.clientX, y: event.clientY, title, rows };
	}

	/** The hover detail for a Tree or Size-map node (path, language, lines, fan-in/out). */
	showNodeTip(event: PointerEvent, node: TreeNode) {
		const fmt = (n: number) => n.toLocaleString();
		if (node.file !== undefined) {
			const i = node.file;
			this.showTip(event, node.path, [
				['Language', LANG_NAMES[node.lang]],
				['Lines', fmt(node.loc)],
				['Imported by', fmt(this.derived.fanIn[i])],
				['Imports', fmt(this.derived.fanOut[i])]
			]);
		} else {
			this.showTip(event, node.path || node.name, [
				['Files', fmt(node.files)],
				['Lines', fmt(node.loc)]
			]);
		}
	}

	hideTip() {
		this.tip = null;
	}
}
