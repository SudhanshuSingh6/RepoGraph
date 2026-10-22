import type { EntityDecl } from '#analysis/types/index.ts';
import { db } from './client';

/** A project's ORM entities, with `file` as an index into the same byte-wise path order
 * `getProjectGraph` uses, so it lines up with `/graph`'s files. */
export async function getProjectEntities(projectId: string): Promise<EntityDecl[]> {
	const [fileRows, entityRows] = await Promise.all([
		db()`select id from parsed_files where project_id = ${projectId} order by path collate "C"`,
		db()`
			select file_id, name, table_name, orm, fields, relations, line from parsed_entities
			where project_id = ${projectId}
		`
	]);
	const indexOf = new Map<string, number>(fileRows.map((r, i) => [r.id, i]));
	return entityRows
		.map((r) => ({
			file: indexOf.get(r.file_id)!,
			name: r.name,
			table: r.table_name,
			orm: r.orm,
			fields: r.fields,
			relations: r.relations,
			line: r.line
		}))
		.sort((a, b) => a.file - b.file || a.line - b.line);
}
