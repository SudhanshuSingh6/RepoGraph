import { describe, expect, it } from 'vitest';
import { codeChallenge, randomToken } from './pkce';

describe('pkce', () => {
	it('matches the RFC 7636 Appendix B S256 test vector', () => {
		expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});

	it('generates distinct 43-char base64url tokens', () => {
		const a = randomToken();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(randomToken()).not.toBe(a);
	});
});
