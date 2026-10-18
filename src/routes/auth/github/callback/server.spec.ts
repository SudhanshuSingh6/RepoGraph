import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';

const consumeOAuthState = vi.fn();
const exchangeCode = vi.fn();
const fetchGithubUser = vi.fn();
const upsertGithubUser = vi.fn();
const createSession = vi.fn();

vi.mock('#lib/server/db/oauthStates.ts', () => ({ consumeOAuthState }));
vi.mock('#lib/server/db/users.ts', () => ({ upsertGithubUser }));
vi.mock('#lib/server/db/sessions.ts', () => ({ createSession, SESSION_TTL_DAYS: 30 }));
vi.mock('#lib/server/auth/github.ts', () => ({ exchangeCode, fetchGithubUser }));

const { GET } = await import('./+server');

function fakeCookies(initial: Record<string, string>) {
	const jar = new Map(Object.entries(initial));
	return {
		jar,
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => void jar.set(name, value),
		delete: (name: string) => void jar.delete(name)
	};
}

async function call(query: string, cookies: Record<string, string>) {
	const jar = fakeCookies(cookies);
	const event = { url: new URL(`http://localhost/auth/github/callback?${query}`), cookies: jar };
	try {
		await GET(event as never);
		throw new Error('handler did not throw');
	} catch (e) {
		return { result: e, jar: jar.jar };
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	consumeOAuthState.mockResolvedValue('verifier');
	exchangeCode.mockResolvedValue('token');
	fetchGithubUser.mockResolvedValue({ id: 1, login: 'octo', avatar_url: null });
	upsertGithubUser.mockResolvedValue({ id: 'user-1' });
	createSession.mockResolvedValue('session-1');
});

describe('GET /auth/github/callback', () => {
	it('rejects a missing state', async () => {
		const { result } = await call('code=abc', { oauth_state: 's1' });
		expect(isHttpError(result, 400)).toBe(true);
		expect(consumeOAuthState).not.toHaveBeenCalled();
		expect(exchangeCode).not.toHaveBeenCalled();
	});

	it('rejects a state that does not match this browser', async () => {
		const { result } = await call('code=abc&state=attacker', { oauth_state: 's1' });
		expect(isHttpError(result, 400)).toBe(true);
		expect(exchangeCode).not.toHaveBeenCalled();
	});

	it('rejects when there is no state cookie', async () => {
		const { result } = await call('code=abc&state=s1', {});
		expect(isHttpError(result, 400)).toBe(true);
		expect(exchangeCode).not.toHaveBeenCalled();
	});

	it('rejects an unknown, expired, or already-used state', async () => {
		consumeOAuthState.mockResolvedValue(null);
		const { result } = await call('code=abc&state=s1', { oauth_state: 's1' });
		expect(isHttpError(result, 400)).toBe(true);
		expect(exchangeCode).not.toHaveBeenCalled();
	});

	it('signs in with a valid state and sets the session cookie', async () => {
		const { result, jar } = await call('code=abc&state=s1', { oauth_state: 's1' });
		expect(isRedirect(result)).toBe(true);
		expect(exchangeCode).toHaveBeenCalledWith('abc', 'verifier');
		expect(upsertGithubUser).toHaveBeenCalledWith({
			githubId: 1,
			username: 'octo',
			avatarUrl: null
		});
		expect(jar.get('session')).toBe('session-1');
		expect(jar.has('oauth_state')).toBe(false);
	});
});
