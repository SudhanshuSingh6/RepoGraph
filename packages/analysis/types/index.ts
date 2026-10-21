// Pure type-declaration analysis (repograph-spec.md §11/§14): resolving supertype names
// to declarations in the repo. Same purity rules as ../graph.
export type { TypeDecl, TypeEdge, TypeKind } from './types.ts';
export { langFamily, nameResolver, resolveSupertypes, simpleName } from './resolve.ts';
