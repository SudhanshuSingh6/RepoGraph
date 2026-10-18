import type { Handle } from '@sveltejs/kit/hooks';
import { getSessionUser } from '#lib/server/db/sessions.ts';
import { SESSION_COOKIE, clearSessionCookie } from '#lib/server/auth/cookies.ts';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(SESSION_COOKIE);
	event.locals.user = sessionId ? await getSessionUser(sessionId) : null;
	if (sessionId && !event.locals.user) clearSessionCookie(event.cookies);
	return resolve(event);
};
