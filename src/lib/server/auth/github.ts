import { GITHUB_CALLBACK_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from '$app/env/private';

// Login only needs the user's profile — never request `repo` (see BUILD_PLAN.md Phase 2).
const SCOPE = 'read:user';

export type GithubProfile = { id: number; login: string; avatar_url: string | null };

function config() {
	if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_CALLBACK_URL) {
		throw new Error(
			'GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and GITHUB_CALLBACK_URL must be set — see .env.example'
		);
	}
	return {
		clientId: GITHUB_CLIENT_ID,
		clientSecret: GITHUB_CLIENT_SECRET,
		callbackUrl: GITHUB_CALLBACK_URL
	};
}

export function authorizeUrl(state: string, challenge: string): string {
	const { clientId, callbackUrl } = config();
	const url = new URL('https://github.com/login/oauth/authorize');
	url.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callbackUrl,
		scope: SCOPE,
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		allow_signup: 'true'
	}).toString();
	return url.toString();
}

/** Exchanges the callback `code` for an access token; throws with GitHub's message on failure. */
export async function exchangeCode(code: string, verifier: string): Promise<string> {
	const { clientId, clientSecret, callbackUrl } = config();
	const res = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: callbackUrl,
			code_verifier: verifier
		})
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) {
		throw new Error(
			body.error_description || body.error || `token exchange failed (${res.status})`
		);
	}
	return body.access_token;
}

export async function fetchGithubUser(token: string): Promise<GithubProfile> {
	const res = await fetch('https://api.github.com/user', {
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'User-Agent': 'Repograph'
		}
	});
	if (!res.ok) throw new Error(`GitHub /user request failed (${res.status})`);
	const { id, login, avatar_url } = await res.json();
	return { id, login, avatar_url: avatar_url ?? null };
}
