import { db } from './client';
import type { Tx } from './transaction';

export type ProjectStatus = 'pending' | 'cloning' | 'parsing' | 'ready' | 'error';

export type Project = {
	id: string;
	ownerId: string;
	name: string;
	source: 'github' | 'upload';
	githubOwner: string | null;
	githubRepo: string | null;
	githubBranch: string | null;
	status: ProjectStatus;
	errorMessage: string | null;
	skippedLargeFiles: number;
	createdAt: Date;
};

export type LanguageTotals = { lang: string; files: number; lines: number };
export type ProjectSummary = {
	files: number;
	lines: number;
	imports: number;
	languages: LanguageTotals[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function insertProject(
	tx: Tx,
	input: {
		ownerId: string;
		name: string;
		source: 'github' | 'upload';
		githubOwner?: string;
		githubRepo?: string;
		githubBranch?: string | null;
	}
): Promise<string> {
	const [row] = await tx`
		insert into projects (owner_id, name, source, github_owner, github_repo, github_branch)
		values (${input.ownerId}, ${input.name}, ${input.source}, ${input.githubOwner ?? null},
			${input.githubRepo ?? null}, ${input.githubBranch ?? null})
		returning id
	`;
	return row.id;
}

export async function saveUpload(tx: Tx, projectId: string, archive: Uint8Array): Promise<void> {
	await tx`insert into project_uploads (project_id, archive) values (${projectId}, ${archive})`;
}

export async function getProject(id: string): Promise<Project | null> {
	if (!UUID.test(id)) return null;
	const [row] = await db()`
		select id, owner_id, name, source, github_owner, github_repo, github_branch, status,
			error_message, skipped_large_files, created_at
		from projects where id = ${id}
	`;
	if (!row) return null;
	return {
		id: row.id,
		ownerId: row.owner_id,
		name: row.name,
		source: row.source,
		githubOwner: row.github_owner,
		githubRepo: row.github_repo,
		githubBranch: row.github_branch,
		status: row.status,
		errorMessage: row.error_message,
		skippedLargeFiles: row.skipped_large_files,
		createdAt: row.created_at
	};
}

export async function getProjectSummary(projectId: string): Promise<ProjectSummary> {
	const rows = await db()`
		select lang, count(*)::int as files, coalesce(sum(loc), 0)::int as lines
		from parsed_files where project_id = ${projectId}
		group by lang order by lines desc
	`;
	const [{ imports }] = await db()`
		select count(*)::int as imports from parsed_edges where project_id = ${projectId}
	`;
	const languages = rows.map((r) => ({ lang: r.lang, files: r.files, lines: r.lines }));
	return {
		files: languages.reduce((n, l) => n + l.files, 0),
		lines: languages.reduce((n, l) => n + l.lines, 0),
		imports,
		languages
	};
}
