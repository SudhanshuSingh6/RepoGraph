import type { FileNode } from '../graph/types.ts';
import type { Endpoint, StoredEndpoint } from './types.ts';

export const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ANY'];

const methodRank = (m: string) => {
	const i = METHOD_ORDER.indexOf(m);
	return i === -1 ? METHOD_ORDER.length : i;
};

/** Stored per-file endpoints → `Endpoint`s with file indexes, in path then method
 * order. A handler in a file the graph doesn't have keeps its label only. */
export function toEndpoints(
	rows: { path: string; endpoints: StoredEndpoint[] }[],
	files: FileNode[]
): Endpoint[] {
	const indexOf = new Map(files.map((f, i) => [f.path, i]));
	const out: Endpoint[] = [];
	for (const row of rows) {
		const file = indexOf.get(row.path);
		if (file === undefined) continue;
		for (const e of row.endpoints) {
			const handlerFile = e.handler.path === null ? null : (indexOf.get(e.handler.path) ?? null);
			out.push({
				file,
				line: e.line,
				framework: e.framework,
				method: e.method,
				path: e.path,
				prefix: e.prefix,
				regex: e.regex ?? false,
				handler: {
					label: e.handler.label,
					file: handlerFile,
					line: handlerFile === null ? null : e.handler.line
				}
			});
		}
	}
	return out.sort(
		(a, b) =>
			(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
			methodRank(a.method) - methodRank(b.method) ||
			a.file - b.file ||
			a.line - b.line
	);
}

export type EndpointGroup = { key: string; label: string; endpoints: Endpoint[] };

const segments = (path: string) => path.split('/').filter(Boolean);

/**
 * Groups endpoints for the list: by the first path segment after the prefix every
 * endpoint shares (so an app that lives entirely under `/api` groups by `/api/users`,
 * `/api/orders`, …), or by the file that declares them.
 */
export function groupEndpoints(
	endpoints: Endpoint[],
	by: 'path' | 'file',
	files: FileNode[]
): EndpointGroup[] {
	const groups = new Map<string, EndpointGroup>();
	const add = (key: string, label: string, e: Endpoint) => {
		const g = groups.get(key) ?? { key, label, endpoints: [] };
		g.endpoints.push(e);
		groups.set(key, g);
	};
	if (by === 'file') {
		for (const e of endpoints) add(String(e.file), files[e.file].path, e);
		return [...groups.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
	}
	const split = endpoints.map((e) => segments(e.path));
	// The shared prefix is measured over the deeper paths only, so a lone `/` health
	// check doesn't stop an app that lives under `/api` from grouping by `/api/users`.
	const deep = split.filter((s) => s.length >= 2);
	let common = 0;
	if (deep.length > 1) {
		const first = deep[0];
		while (
			common < first.length &&
			deep.every((s) => s.length > common + 1 && s[common] === first[common])
		) {
			common++;
		}
	}
	endpoints.forEach((e, i) => {
		const label = '/' + split[i].slice(0, Math.min(common + 1, split[i].length)).join('/');
		add(label, label, e);
	});
	return [...groups.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
}

/** Search over the path, the handler and the declaring file, case-insensitively. */
export function matchesEndpoint(e: Endpoint, files: FileNode[], query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return [e.path, e.handler.label, files[e.file].path].some((s) => s.toLowerCase().includes(q));
}
