import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url — used for both the OAuth `state` and the PKCE verifier. */
export function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

/** PKCE S256 code challenge (RFC 7636 §4.2). */
export function codeChallenge(verifier: string): string {
	return createHash('sha256').update(verifier).digest('base64url');
}
