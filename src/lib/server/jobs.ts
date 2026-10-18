// Scalability seam: the only way to start a parse. Today it inserts a parse_jobs row in
// the caller's transaction (the worker polls the table). With Redis/BullMQ later, only
// this body changes — e.g. `queue.add('parse', { projectId })` — not the call sites.
import { insertParseJob } from '#lib/server/db/parseJobs.ts';
import type { Tx } from '#lib/server/db/transaction.ts';

export async function enqueueParseJob(projectId: string, tx: Tx): Promise<void> {
	await insertParseJob(tx, projectId);
}
