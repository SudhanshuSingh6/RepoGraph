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
import type { Endpoint } from '#analysis/apis/index.ts';
import { possiblyUnused } from '#analysis/hotspots/index.ts';
import {
	referencedTypes,
	resolveRelations,
	type EntityDecl,
	type EntityEdge,
	type TypeDecl
} from '#analysis/types/index.ts';
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

export type View = 'tree' | 'treemap' | 'graph' | 'uml' | 'er' | 'hotspots' | 'apis';

/** `entity` indexes `Workspace.entities` (names aren't unique across ORMs). */
export type Selection = { file: number } | { folder: string } | { entity: number } | null;

export type ColorBy = 'lang' | 'fanIn' | 'fanOut' | 'cycles';

/** A chat bubble. `failed` marks an error reply; its question is not resent as history. */
export type ChatMessage = {
	role: 'user' | 'assistant';
	text: string;
	failed?: boolean;
	filesRead?: string[];
};

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
	/** The chat conversation (§17): kept while the project is open, not saved. */
	chat = $state<ChatMessage[]>([]);

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
	// ER Diagram (§12): entities, likewise loaded on first use.
	entities = $state.raw<EntityDecl[] | null>(null);
	entitiesError = $state<string | null>(null);
	// APIs: detected endpoints, loaded on first use; `apisHasData` is false for a project
	// imported before the APIs view existed (it needs a re-import).
	apis = $state.raw<Endpoint[] | null>(null);
	apisHasData = $state(true);
	apisError = $state<string | null>(null);
	apisGroup = $state<'path' | 'file'>('path');
	#requested: Record<string, boolean> = {}; // not reactive: only gates the fetch

	// `refresh()` in the prototype: re-derived whenever a filter changes.
	readonly active: boolean[];
	readonly derived: Derived;
	readonly tree: TreeNode;
	/** Every "possibly unused" file (§14), best candidates first; null until types load.
	 * Hotspots shows the top of it, the side panel's overview its length. */
	readonly unused: number[] | null;
	/** ER relationships resolved to entities (§12); empty until entities load. */
	readonly relations: EntityEdge[];
	#referenced: Set<number> | null;

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
		// The extends/implements cross-reference spans the whole repo, whatever the filters.
		this.#referenced = $derived(
			this.types ? referencedTypes(this.types, this.graph.files, this.full.adj) : null
		);
		this.unused = $derived(
			this.types && this.#referenced
				? possiblyUnused(
						this.graph.files,
						this.derived,
						this.types.map((t) => t.file),
						this.#referenced,
						Infinity
					)
				: null
		);
		this.relations = $derived(
			this.entities ? resolveRelations(this.entities, this.graph.files, this.full.adj) : []
		);
	}

	/** Fetches `/types` once, the first time a view needs it. */
	loadTypes() {
		this.#load<{ types: TypeDecl[] }>(
			'types',
			'classes',
			(body) => (this.types = body.types),
			(message) => (this.typesError = message)
		);
	}

	/** Fetches `/entities` once, the first time the ER Diagram opens. */
	loadEntities() {
		this.#load<{ entities: EntityDecl[] }>(
			'entities',
			'entities',
			(body) => (this.entities = body.entities),
			(message) => (this.entitiesError = message)
		);
	}

	/** Fetches `/apis` once, the first time the APIs view opens. */
	loadApis() {
		this.#load<{ endpoints: Endpoint[]; hasFlowData: boolean }>(
			'apis',
			'APIs',
			(body) => {
				this.apis = body.endpoints;
				this.apisHasData = body.hasFlowData;
			},
			(message) => (this.apisError = message)
		);
	}

	#load<T>(path: string, what: string, done: (body: T) => void, fail: (msg: string) => void) {
		if (this.#requested[path]) return;
		this.#requested[path] = true;
		fetch(`/api/projects/${this.id}/${path}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`The ${what} couldn't be loaded (${res.status}).`);
				done((await res.json()) as T);
			})
			.catch((e: Error) => {
				fail(e.message);
				this.#requested[path] = false; // the next visit tries again
			});
	}

	isSelectedEntity(i: number): boolean {
		const sel = this.selection;
		return sel !== null && 'entity' in sel && sel.entity === i;
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
