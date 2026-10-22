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

export type Orm = 'jpa' | 'typeorm' | 'django' | 'sqlalchemy';
export type RelationKind = '1–1' | '1–N' | 'N–1' | 'N–N' | 'RelatedTo';

/** An ORM entity (repograph-spec.md §12), as `/api/projects/:id/entities` serves it.
 * Relationship targets are as written in the source, unresolved. */
export type EntityDecl = {
	file: number; // index into Graph.files
	name: string;
	table: string; // the declared table name, else the class name
	orm: Orm;
	fields: { name: string; type: string; pk: boolean }[];
	relations: { field: string; kind: RelationKind; target: string }[];
	line: number;
};

/** A relationship resolved to another entity (or the same one) in the repo. */
export type EntityEdge = { from: number; to: number; field: string; kind: RelationKind };
