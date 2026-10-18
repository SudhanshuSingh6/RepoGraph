import { redirect } from '@sveltejs/kit';
import { deleteSession } from '#lib/server/db/sessions.ts';
import { SESSION_COOKIE, clearSessionCookie } from '#lib/server/auth/cookies.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (sessionId) await deleteSession(sessionId);
	clearSessionCookie(cookies);
	redirect(303, '/');
};
