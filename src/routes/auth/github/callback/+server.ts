import { error, redirect } from '@sveltejs/kit';
import { consumeOAuthState } from '#lib/server/db/oauthStates.ts';
import { upsertGithubUser } from '#lib/server/db/users.ts';
import { createSession } from '#lib/server/db/sessions.ts';
import { exchangeCode, fetchGithubUser } from '#lib/server/auth/github.ts';
import {
	OAUTH_STATE_COOKIE,
	clearOAuthStateCookie,
	setSessionCookie
} from '#lib/server/auth/cookies.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	// Verify `state` before anything else — this is the flow's CSRF protection.
	const state = url.searchParams.get('state');
	const expected = cookies.get(OAUTH_STATE_COOKIE);
	clearOAuthStateCookie(cookies);
	if (!state || !expected || state !== expected) error(400, 'Invalid login state.');

	const verifier = await consumeOAuthState(state);
	if (!verifier) error(400, 'Login link expired. Please sign in again.');

	const code = url.searchParams.get('code');
	if (!code)
		error(400, url.searchParams.get('error_description') ?? 'GitHub sign-in was cancelled.');

	let sessionId: string;
	try {
		const profile = await fetchGithubUser(await exchangeCode(code, verifier));
		const user = await upsertGithubUser({
			githubId: profile.id,
			username: profile.login,
			avatarUrl: profile.avatar_url
		});
		sessionId = await createSession(user.id);
	} catch (e) {
		error(400, `GitHub sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
	}

	setSessionCookie(cookies, sessionId);
	redirect(302, '/');
};
