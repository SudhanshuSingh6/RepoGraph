// Pure type-declaration analysis (repograph-spec.md §11/§12/§14): resolving supertype
// names and entity relationship targets to declarations in the repo. Same purity rules as ../graph.
export type {
	EntityDecl,
	EntityEdge,
	Orm,
	RelationKind,
	TypeDecl,
	TypeEdge,
	TypeKind
} from './types.ts';
export {
	langFamily,
	nameResolver,
	resolveRelations,
	resolveSupertypes,
	simpleName
} from './resolve.ts';
