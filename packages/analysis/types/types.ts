export type TypeKind = 'class' | 'abstract' | 'interface' | 'enum' | 'record';

/** A class/interface declaration (repograph-spec.md §11), as `/api/projects/:id/types`
 * serves it. Supertype names are as written in the source, unresolved. */
export type TypeDecl = {
	file: number; // index into Graph.files
	name: string;
	kind: TypeKind;
	extends: string[];
	implements: string[];
	line: number;
};

/** A supertype reference resolved to another declaration in the repo. */
export type TypeEdge = { child: number; parent: number; kind: 'extends' | 'implements' };
