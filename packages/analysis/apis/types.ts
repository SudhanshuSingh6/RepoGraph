export type Framework = 'spring' | 'nestjs' | 'express' | 'flask' | 'fastapi' | 'django';

/**
 * How much of an endpoint's path is known:
 * - 'root': declared on the application itself;
 * - 'resolved': on a router/blueprint/urls module whose every mount up to an app was
 *   found, so the prefixes are included;
 * - 'unknown': the router was never seen mounted (or a mount couldn't be resolved),
 *   so the path is relative to it.
 */
export type PrefixStatus = 'root' | 'resolved' | 'unknown';

/** An HTTP endpoint, as `/api/projects/:id/apis` serves it. */
export type Endpoint = {
	file: number; // index into Graph.files: where the route is declared
	line: number;
	framework: Framework;
	method: string; // GET | POST | PUT | PATCH | DELETE | OPTIONS | HEAD | ANY
	path: string; // `{x}` marks a piece that isn't a literal (a constant, a setting)
	prefix: PrefixStatus;
	regex: boolean; // a Django re_path()/url() pattern, shown as written
	handler: { label: string; file: number | null; line: number | null };
};

/** One file's stored endpoints, as the worker wrote them (paths, not indexes). */
export type StoredEndpoint = {
	framework: Framework;
	method: string;
	path: string;
	prefix: PrefixStatus;
	line: number;
	regex?: boolean;
	handler: { label: string; path: string | null; fn: number | null; line: number | null };
};
