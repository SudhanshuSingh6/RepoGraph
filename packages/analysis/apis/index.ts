// Pure APIs-view analysis: endpoints served by the repo and their static call flows.
// Calls arrive already resolved by the worker; this traces and summarises them. Same
// purity rules as ../graph.
export type { Endpoint, Framework, PrefixStatus, StoredEndpoint } from './types.ts';
export {
	METHOD_ORDER,
	groupEndpoints,
	matchesEndpoint,
	toEndpoints,
	type EndpointGroup
} from './endpoints.ts';
export {
	MAX_DEPTH,
	MAX_NODES,
	layerOf,
	summarize,
	traceEndpoint,
	type Flow,
	type FlowEdge,
	type FlowNode,
	type Layer,
	type StoredCall,
	type StoredFunction,
	type UntracedReason
} from './trace.ts';
export { buildApisModel, type ApisModel } from './model.ts';
