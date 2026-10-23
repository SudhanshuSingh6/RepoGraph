import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const listKeys = vi.fn();
const saveKey = vi.fn();
const getKey = vi.fn();
const setActive = vi.fn();
const setModel = vi.fn();
const deleteKey = vi.fn();
const chatAvailable = vi.fn();
const probe = vi.fn();
const listModels = vi.fn();
vi.mock('#lib/server/chat/keys.ts', () => ({
	chatAvailable,
	deleteKey,
	getKey,
	listKeys,
	saveKey,
	setActive,
	setModel
}));
vi.mock('#lib/server/chat/probe.ts', () => ({ probe }));
vi.mock('#lib/server/chat/providers/index.ts', () => ({
	PROVIDER_ADAPTERS: { openai: { id: 'openai', listModels } }
}));

const { GET, POST, PATCH, DELETE } = await import('./+server');
const { ProviderError, UnsupportedModel } = await import('#lib/server/chat/errors.ts');

const alice = { id: 'u-alice', githubId: '1', username: 'alice', avatarUrl: null };
const SECRET = 'sk-proj-supersecretvalue1234';
const LISTED = [
	{ provider: 'openai', hint: '…1234', model: 'gpt-x', verified: true, active: true }
];

type Handler = typeof GET;
async function call(handler: Handler, body?: unknown, user: typeof alice | null = alice) {
	const request = new Request('http://localhost/api/chat/keys', {
		method: body === undefined ? 'GET' : 'POST',
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	try {
		return await handler({ locals: { user }, request } as never);
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	chatAvailable.mockReturnValue(true);
	listKeys.mockResolvedValue(LISTED);
	listModels.mockResolvedValue(['gpt-x']);
	getKey.mockResolvedValue({ ...LISTED[0], apiKey: SECRET });
});

describe('/api/chat/keys', () => {
	it('requires sign-in for every method', async () => {
		for (const h of [GET, POST, PATCH, DELETE]) {
			expect(isHttpError(await call(h, h === GET ? undefined : {}, null), 401)).toBe(true);
		}
	});

	it('is 503 without CHAT_KEY_SECRET', async () => {
		chatAvailable.mockReturnValue(false);
		expect(isHttpError(await call(GET), 503)).toBe(true);
	});

	it('lists keys by hint, never the key', async () => {
		const res = (await call(GET)) as Response;
		const text = await res.text();
		expect(JSON.parse(text)).toEqual({ keys: LISTED });
		expect(text).not.toContain(SECRET);
	});

	it('saves only after the key lists models and the model passes the probe', async () => {
		const res = (await call(POST, {
			provider: 'openai',
			apiKey: ` ${SECRET} `,
			model: 'gpt-x'
		})) as Response;
		expect(res.status).toBe(200);
		expect(listModels).toHaveBeenCalledWith(SECRET);
		expect(probe).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai' }), SECRET, 'gpt-x');
		expect(saveKey).toHaveBeenCalledWith('u-alice', 'openai', SECRET, 'gpt-x');
		expect(await res.text()).not.toContain(SECRET);
	});

	it('stores nothing when the key is rejected (400)', async () => {
		listModels.mockRejectedValueOnce(
			new ProviderError('key_rejected', 'That key was rejected by OpenAI.')
		);
		const res = (await call(POST, {
			provider: 'openai',
			apiKey: SECRET,
			model: 'gpt-x'
		})) as Response;
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: 'key_rejected',
			message: 'That key was rejected by OpenAI.'
		});
		expect(probe).not.toHaveBeenCalled();
		expect(saveKey).not.toHaveBeenCalled();
	});

	it('stores nothing when the model is unsupported (422 with the reason)', async () => {
		probe.mockRejectedValueOnce(new UnsupportedModel('wrong_endpoint', 'not a chat model'));
		const res = (await call(POST, {
			provider: 'openai',
			apiKey: SECRET,
			model: 'text-embedding-3'
		})) as Response;
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({
			error: 'unsupported_model',
			reason: 'wrong_endpoint'
		});
		expect(saveKey).not.toHaveBeenCalled();
	});

	it('is 400 for an unknown provider or missing fields', async () => {
		expect(
			isHttpError(await call(POST, { provider: 'mistral', apiKey: 'k', model: 'm' }), 400)
		).toBe(true);
		expect(isHttpError(await call(POST, { provider: 'openai', apiKey: '', model: 'm' }), 400)).toBe(
			true
		);
		expect(isHttpError(await call(POST, { provider: 'openai', apiKey: 'k' }), 400)).toBe(true);
	});

	it('PATCH re-probes a changed model with the saved key before switching', async () => {
		expect(((await call(PATCH, { provider: 'openai', model: 'gpt-y' })) as Response).status).toBe(
			200
		);
		expect(probe).toHaveBeenCalledWith(expect.anything(), SECRET, 'gpt-y');
		expect(setModel).toHaveBeenCalledWith('u-alice', 'openai', 'gpt-y');
		expect(setActive).toHaveBeenCalledWith('u-alice', 'openai');

		vi.clearAllMocks();
		probe.mockRejectedValueOnce(new UnsupportedModel('not_found', 'nope'));
		expect(((await call(PATCH, { provider: 'openai', model: 'gpt-z' })) as Response).status).toBe(
			422
		);
		expect(setModel).not.toHaveBeenCalled();
		expect(setActive).not.toHaveBeenCalled();
	});

	it('PATCH only switches the active provider when the model is unchanged', async () => {
		await call(PATCH, { provider: 'openai', model: 'gpt-x' });
		await call(PATCH, { provider: 'openai' });
		expect(probe).not.toHaveBeenCalled();
		expect(setActive).toHaveBeenCalledTimes(2);
	});

	it('is 404 for a provider with no saved key', async () => {
		getKey.mockResolvedValue(null);
		expect(isHttpError(await call(PATCH, { provider: 'openai' }), 404)).toBe(true);
		deleteKey.mockResolvedValue(false);
		expect(isHttpError(await call(DELETE, { provider: 'openai' }), 404)).toBe(true);
	});
});
