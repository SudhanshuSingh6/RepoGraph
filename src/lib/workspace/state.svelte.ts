import { SvelteSet } from 'svelte/reactivity';
import {
	UNGROUPED,
	buildTree,
	derive,
	detailedLevelWithin,
	type Derived,
	type Edge,
	type FileNode,
	type Graph,
	type Lang,
	type TreeNode
} from '#analysis/graph/index.ts';
import type { TypeDecl } from '#analysis/types/index.ts';
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
	readonly id: string;
	readonly graph: Graph;
	readonly name: string;
	/** The unfiltered derivation — name resolution and (later) chat see every file. */
	readonly full: Derived;
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
	// Dependencies (§10): Detail level, Spacing and the five checkboxes; `blastFrom` is
	// the node a Blast-radius click started from.
	depLevel = $state(UNGROUPED);
	spacing = $state(1);
	hideUnconnected = $state(true);
	onlyCycles = $state(false);
	allLabels = $state(false);
	blast = $state(false);
	blastFrom = $state<string | null>(null);
	cluster = $state(true);
	// Architecture (§11): component-diagram Detail level, and the package whose class
	// diagram is open (null = the component diagram). Types load on first use.
	umlLevel = $state(UNGROUPED);
	umlFolder = $state<string | null>(null);
	types = $state.raw<TypeDecl[] | null>(null);
	typesError = $state<string | null>(null);
	#typesRequested = false;

	// `refresh()` in the prototype: re-derived whenever a filter changes.
	readonly active: boolean[];
	readonly derived: Derived;
	readonly tree: TreeNode;

	constructor(payload: GraphPayload, name: string, id: string) {
		this.id = id;
		this.graph = { files: payload.files, edges: payload.edges };
		this.name = name;
		this.full = derive(this.graph);
		this.umlLevel = detailedLevelWithin(this.graph.files, 20);
		this.levels = payload.levels.map((l) => l ?? UNGROUPED);
		this.defaultLevel = payload.defaultLevel ?? UNGROUPED;
		this.depLevel = this.defaultLevel;
		this.active = $derived(activeMask(this.graph.files, this.langOn, this.hideTests));
		this.derived = $derived(derive(this.graph, this.active));
		this.tree = $derived(buildTree(this.graph, this.derived, this.name));
	}

	/** Fetches `/types` once, the first time a view needs it. */
	loadTypes() {
		if (this.#typesRequested) return;
		this.#typesRequested = true;
		fetch(`/api/projects/${this.id}/types`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`The classes couldn't be loaded (${res.status}).`);
				this.types = ((await res.json()) as { types: TypeDecl[] }).types;
			})
			.catch((e: Error) => {
				this.typesError = e.message;
				this.#typesRequested = false;
			});
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
