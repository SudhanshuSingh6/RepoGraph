import type { TypeDecl } from '#analysis/types/index.ts';
import { db } from './client';

/** A project's class/interface declarations, with `file` as an index into the same
 * byte-wise path order `getProjectGraph` uses, so it lines up with `/graph`'s files. */
export async function getProjectTypes(projectId: string): Promise<TypeDecl[]> {
	const [fileRows, typeRows] = await Promise.all([
		db()`select id from parsed_files where project_id = ${projectId} order by path collate "C"`,
		db()`
			select file_id, name, kind, extends, implements, line from parsed_types
			where project_id = ${projectId}
		`
	]);
	const indexOf = new Map<string, number>(fileRows.map((r, i) => [r.id, i]));
	return typeRows
		.map((r) => ({
			file: indexOf.get(r.file_id)!,
			name: r.name,
			kind: r.kind,
			extends: r.extends,
			implements: r.implements,
			line: r.line
		}))
		.sort((a, b) => a.file - b.file || a.line - b.line);
}
