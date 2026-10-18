import type { Tx } from './transaction';

export async function insertParseJob(tx: Tx, projectId: string): Promise<void> {
	await tx`insert into parse_jobs (project_id) values (${projectId})`;
}
