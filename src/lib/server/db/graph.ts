import type { Edge, FileNode, Graph } from '#analysis/graph/index.ts';
import { db } from './client';

/** A project's parsed files (metadata only, never source) and import edges, with edges
 * as indexes into `files`. Files are in byte-wise path order, so indexes are stable. */
export async function getProjectGraph(projectId: string): Promise<Graph> {
	const [fileRows, edgeRows] = await Promise.all([
		db()`
			select id, path, lang, loc, is_test from parsed_files
			where project_id = ${projectId} order by path collate "C"
		`,
		db()`select from_file_id, to_file_id from parsed_edges where project_id = ${projectId}`
	]);
	const indexOf = new Map<string, number>();
	const files: FileNode[] = fileRows.map((r, i) => {
		indexOf.set(r.id, i);
		return { path: r.path, lang: r.lang, loc: r.loc, isTest: r.is_test };
	});
	const edges: Edge[] = edgeRows.map((r) => [
		indexOf.get(r.from_file_id)!,
		indexOf.get(r.to_file_id)!
	]);
	edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	return { files, edges };
}
