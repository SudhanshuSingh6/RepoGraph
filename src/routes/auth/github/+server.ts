import { redirect } from '@sveltejs/kit';
import { createOAuthState } from '#lib/server/db/oauthStates.ts';
import { codeChallenge, randomToken } from '#lib/server/auth/pkce.ts';
import { authorizeUrl } from '#lib/server/auth/github.ts';
import { setOAuthStateCookie } from '#lib/server/auth/cookies.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const state = randomToken();
	const verifier = randomToken();
	const url = authorizeUrl(state, codeChallenge(verifier));

	await createOAuthState(state, verifier);
	setOAuthStateCookie(cookies, state);
	redirect(302, url, { external: ['https://github.com'] });
};
