import type { FileNode } from '../graph/types.ts';
import { toEndpoints } from './endpoints.ts';
import { summarize, traceEndpoint, type Flow, type StoredFunction } from './trace.ts';
import type { Endpoint, StoredEndpoint } from './types.ts';

export type ApisModel = { endpoints: Endpoint[]; flows: (Flow | null)[] };

/** Every endpoint with its call flow (null when its handler wasn't found in the
 * repo). `flows[n]` belongs to `endpoints[n]`. */
export function buildApisModel(
	endpointRows: { path: string; endpoints: StoredEndpoint[] }[],
	functionRows: { path: string; functions: StoredFunction[] }[],
	files: FileNode[]
): ApisModel {
	const endpoints = toEndpoints(endpointRows, files);
	const functions = new Map(functionRows.map((r) => [r.path, r.functions]));
	const fileIndex = new Map(files.map((f, i) => [f.path, i]));
	const flows = endpoints.map((e) =>
		e.handler.file === null || e.handler.fn === null
			? null
			: traceEndpoint({ path: files[e.handler.file].path, fn: e.handler.fn }, functions, fileIndex)
	);
	endpoints.forEach((e, n) => Object.assign(e, summarize(flows[n], functions)));
	return { endpoints, flows };
}
