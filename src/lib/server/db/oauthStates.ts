import { db } from './client';

const STATE_TTL_MINUTES = 10;

export async function createOAuthState(state: string, codeVerifier: string): Promise<void> {
	await db()`
		insert into oauth_states (state, code_verifier, expires_at)
		values (${state}, ${codeVerifier}, now() + make_interval(mins => ${STATE_TTL_MINUTES}))
	`;
}

/** Atomically consumes a pending state; returns its PKCE verifier, or null if unknown/expired. */
export async function consumeOAuthState(state: string): Promise<string | null> {
	const [row] = await db()`
		delete from oauth_states
		where state = ${state} and expires_at > now()
		returning code_verifier
	`;
	return row?.code_verifier ?? null;
}
