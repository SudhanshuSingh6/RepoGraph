export type Lang = 'java' | 'js' | 'ts' | 'py';

export type FileNode = {
	path: string;
	lang: Lang;
	loc: number;
	isTest: boolean;
	isEntry: boolean; // looks like an entry point (§5.1): never "possibly unused"
};

/** An import edge as indexes into `Graph.files`: [importer, imported]. */
export type Edge = [from: number, to: number];

export type Graph = { files: FileNode[]; edges: Edge[] };

/** The result of `derive()` (the prototype's `S.D`). Arrays are indexed by file. */
export type Derived = {
	active: boolean[];
	adj: number[][]; // forward: what each file imports
	rev: number[][]; // reverse: who imports each file
	fanIn: number[];
	fanOut: number[];
	cycles: number[][]; // SCCs with >1 member, largest first
	inCycle: boolean[];
};
