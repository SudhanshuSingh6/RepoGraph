import type { Cookies } from '@sveltejs/kit';
import { SESSION_TTL_DAYS } from '#lib/server/db/sessions.ts';

export const SESSION_COOKIE = 'session';
export const OAUTH_STATE_COOKIE = 'oauth_state';

// SvelteKit defaults `secure` to true except on http://localhost.
const base = { path: '/', httpOnly: true, sameSite: 'lax' } as const;

export function setSessionCookie(cookies: Cookies, sessionId: string) {
	cookies.set(SESSION_COOKIE, sessionId, { ...base, maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 });
}

export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, base);
}

export function setOAuthStateCookie(cookies: Cookies, state: string) {
	cookies.set(OAUTH_STATE_COOKIE, state, { ...base, maxAge: 10 * 60 });
}

export function clearOAuthStateCookie(cookies: Cookies) {
	cookies.delete(OAUTH_STATE_COOKIE, base);
}
