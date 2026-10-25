import { error, json } from '@sveltejs/kit';
import { toFnChart } from '#analysis/apis/flowchart.ts';
import { getApisModel } from '#lib/server/apis/model.ts';
import { requireProjectAccess } from '#lib/server/auth/guards.ts';
import type { RequestHandler } from './$types';

/** One function's control-flow chart, `?path=…&fn=…`, when a deeper call is opened.
 * Only this project's stored functions are served. */
export const GET: RequestHandler = async (event) => {
	const project = await requireProjectAccess(event, event.params.id);
	if (project.status !== 'ready' || !project.parsedAt) {
		error(409, 'This project has not finished importing yet.');
	}
	const path = event.url.searchParams.get('path') ?? '';
	const fn = Number(event.url.searchParams.get('fn'));
	const m = await getApisModel({ ...project, parsedAt: project.parsedAt });
	const fns = m.functions.get(path);
	if (!fns || !Number.isInteger(fn) || fn < 0 || fn >= fns.length) error(404, 'No such function.');
	return json({ chart: toFnChart({ path, fn }, m.functions, m.files, m.fileIndex) });
};
