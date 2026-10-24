import type { StoredEndpoint } from '#analysis/apis/index.ts';
import { db } from './client';

/**
 * A project's stored endpoints, per declaring file, and whether it has any flow data
 * at all: a project imported before the APIs view existed has none and needs a
 * re-import, which is different from a repo that simply declares no endpoints.
 */
export async function getProjectEndpoints(
	projectId: string
): Promise<{ rows: { path: string; endpoints: StoredEndpoint[] }[]; hasFlowData: boolean }> {
	const [rows, [{ any }]] = await Promise.all([
		db()`
			select f.path, fl.endpoints from parsed_flows fl join parsed_files f on f.id = fl.file_id
			where fl.project_id = ${projectId} and jsonb_array_length(fl.endpoints) > 0
		`,
		db()`select exists (select 1 from parsed_flows where project_id = ${projectId}) as any`
	]);
	return {
		rows: rows.map((r) => ({ path: r.path, endpoints: r.endpoints })),
		hasFlowData: any
	};
}
