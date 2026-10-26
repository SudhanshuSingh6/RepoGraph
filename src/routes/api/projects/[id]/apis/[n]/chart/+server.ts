import { error, json } from '@sveltejs/kit';
import { toFnChart, type FnChart } from '#analysis/apis/flowchart.ts';
import { detectedQueries } from '#analysis/apis/queries.ts';
import { getApisModel } from '#lib/server/apis/model.ts';
import { requireProjectAccess } from '#lib/server/auth/guards.ts';
import type { RequestHandler } from './$types';

/** Endpoint n's control-flow chart (n indexes `/apis`'s endpoint list): its handler and
 * the functions the handler calls directly, which open inline from the start, and the
 * DB queries detected anywhere in its traced flow. `root` is null when the handler
 * wasn't found in the repo. Deeper calls load from `../../chart`. */
export const GET: RequestHandler = async (event) => {
	const project = await requireProjectAccess(event, event.params.id);
	if (project.status !== 'ready' || !project.parsedAt) {
		error(409, 'This project has not finished importing yet.');
	}
	const n = Number(event.params.n);
	const m = await getApisModel({ ...project, parsedAt: project.parsedAt });
	if (!Number.isInteger(n) || n < 0 || n >= m.endpoints.length) error(404, 'No such endpoint.');
	const h = m.endpoints[n].handler;
	const none = { queries: [], partial: false };
	if (h.file === null || h.fn === null) return json({ root: null, callees: [], queries: none });
	const root = toFnChart(
		{ path: m.files[h.file].path, fn: h.fn },
		m.functions,
		m.files,
		m.fileIndex
	);
	const callees: FnChart[] = [];
	const seen = new Set<string>();
	for (const call of root?.calls ?? []) {
		for (const t of call.targets) {
			const key = `${t.ref.path}#${t.ref.fn}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const c = toFnChart(t.ref, m.functions, m.files, m.fileIndex);
			if (c) callees.push(c);
		}
	}
	return json({ root, callees, queries: detectedQueries(m.flows[n], m.functions) });
};
