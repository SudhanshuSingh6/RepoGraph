import { db } from './client';
import { toUser, type User } from './users';

export const SESSION_TTL_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createSession(userId: string): Promise<string> {
	const [row] = await db()`
		insert into sessions (user_id, expires_at)
		values (${userId}, now() + make_interval(days => ${SESSION_TTL_DAYS}))
		returning id
	`;
	return row.id;
}

/** The session's user, or null if the session is unknown, expired, or malformed. */
export async function getSessionUser(sessionId: string): Promise<User | null> {
	if (!UUID.test(sessionId)) return null;
	const [row] = await db()`
		select u.id, u.github_id, u.username, u.avatar_url
		from sessions s join users u on u.id = s.user_id
		where s.id = ${sessionId} and s.expires_at > now()
	`;
	return row ? toUser(row) : null;
}

export async function deleteSession(sessionId: string): Promise<void> {
	if (!UUID.test(sessionId)) return;
	await db()`delete from sessions where id = ${sessionId}`;
}
