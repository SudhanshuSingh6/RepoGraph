import { db } from './client';

export type User = {
	id: string;
	githubId: string;
	username: string;
	avatarUrl: string | null;
};

export async function upsertGithubUser(input: {
	githubId: number;
	username: string;
	avatarUrl: string | null;
}): Promise<User> {
	const [row] = await db()`
		insert into users (github_id, username, avatar_url)
		values (${input.githubId}, ${input.username}, ${input.avatarUrl})
		on conflict (github_id) do update
			set username = excluded.username, avatar_url = excluded.avatar_url
		returning id, github_id, username, avatar_url
	`;
	return toUser(row);
}

export function toUser(row: Record<string, unknown>): User {
	return {
		id: row.id as string,
		githubId: String(row.github_id),
		username: row.username as string,
		avatarUrl: (row.avatar_url as string | null) ?? null
	};
}
