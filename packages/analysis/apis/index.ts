// Pure APIs-view analysis: endpoints served by the repo (and, in later phases, their
// call flows). Same purity rules as ../graph.
export type { Endpoint, Framework, PrefixStatus, StoredEndpoint } from './types.ts';
export {
	METHOD_ORDER,
	groupEndpoints,
	matchesEndpoint,
	toEndpoints,
	type EndpointGroup
} from './endpoints.ts';
