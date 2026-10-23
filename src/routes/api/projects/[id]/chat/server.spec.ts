import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const getProject = vi.fn();
const chatAvailable = vi.fn();
const getActiveKey = vi.fn();
const setModelVerified = vi.fn();
const probe = vi.fn();
const runChat = vi.fn();
const getChatRepo = vi.fn();
vi.mock('#lib/server/db/projects.ts', () => ({ getProject }));
vi.mock('#lib/server/chat/keys.ts', () => ({ chatAvailable, getActiveKey, setModelVerified }));
vi.mock('#lib/server/chat/probe.ts', () => ({ probe }));
vi.mock('#lib/server/chat/converse.ts', () => ({ runChat }));
vi.mock('#lib/server/chat/repo.ts', () => ({ getChatRepo }));
vi.mock('#lib/server/chat/providers/index.ts', () => ({
	PROVIDER_ADAPTERS: { anthropic: { id: 'anthropic' }, openai: { id: 'openai' } }
}));

const { POST } = await import('./+server');
const { ProviderError, UnsupportedModel } = await import('#lib/server/chat/errors.ts');

const alice = { id: 'u-alice', githubId: '1', username: 'alice', avatarUrl: null };
const ready = { id: 'p1', ownerId: 'u-alice', name: 'demo', status: 'ready', parsedAt: new Date() };
const KEY = {
	provider: 'anthropic',
	apiKey: 'sk-ant-secret',
	model: 'claude-x',
	hint: '…cret',
	verified: true,
	active: true
};
const ASK = [{ role: 'user', content: 'What is this?' }];

async function call(body: unknown = { messages: ASK }, user: typeof alice | null = alice) {
	const request = new Request('http://localhost/api/projects/p1/chat', {
		method: 'POST',
		body: JSON.stringify(body)
	});
	try {
		return await POST({ params: { id: 'p1' }, locals: { user }, request } as never);
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	getProject.mockResolvedValue(ready);
	chatAvailable.mockReturnValue(true);
	getActiveKey.mockResolvedValue(KEY);
	getChatRepo.mockResolvedValue({ name: 'demo' });
	runChat.mockResolvedValue({
		reply: 'A demo.',
		toolCalls: [{ name: 'getFile', input: { path: 'a.ts' } }],
		filesRead: ['a.ts'],
		usage: { input: 10, output: 2 }
	});
});

describe('POST /api/projects/:id/chat', () => {
	it("answers on the user's active key and model", async () => {
		const res = (await call()) as Response;
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			reply: 'A demo.',
			toolCalls: [{ name: 'getFile', input: { path: 'a.ts' } }],
			filesRead: ['a.ts'],
			usage: { input: 10, output: 2 },
			provider: 'anthropic',
			model: 'claude-x'
		});
		expect(runChat).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: 'sk-ant-secret', model: 'claude-x', history: ASK })
		);
		expect(probe).not.toHaveBeenCalled(); // already verified
	});

	it('requires sign-in, even on a public project (401)', async () => {
		getProject.mockResolvedValue({ ...ready, ownerId: null });
		expect(isHttpError(await call(undefined, null), 401)).toBe(true);
		expect(runChat).not.toHaveBeenCalled();
	});

	it("hides another user's project (404)", async () => {
		getProject.mockResolvedValue({ ...ready, ownerId: 'u-bob' });
		expect(isHttpError(await call(), 404)).toBe(true);
	});

	it('is 409 until ready, 503 without CHAT_KEY_SECRET, 412 without a key', async () => {
		getProject.mockResolvedValueOnce({ ...ready, status: 'parsing', parsedAt: null });
		expect(isHttpError(await call(), 409)).toBe(true);
		chatAvailable.mockReturnValueOnce(false);
		expect(isHttpError(await call(), 503)).toBe(true);
		getActiveKey.mockResolvedValueOnce(null);
		const e = await call();
		expect(isHttpError(e, 412)).toBe(true);
		expect((e as { body: { message: string } }).body.message).toBe(
			'Add an API key to start chatting.'
		);
		expect(runChat).not.toHaveBeenCalled();
	});

	it.each([
		['no messages', { messages: [] }],
		['not alternating', { messages: [ASK[0], ASK[0]] }],
		['ending with the assistant', { messages: [ASK[0], { role: 'assistant', content: 'x' }] }],
		['an empty message', { messages: [{ role: 'user', content: '  ' }] }],
		['an oversized message', { messages: [{ role: 'user', content: 'x'.repeat(8001) }] }],
		[
			'too many messages',
			{
				messages: Array.from({ length: 41 }, (_, i) => ({
					role: i % 2 ? 'assistant' : 'user',
					content: 'x'
				}))
			}
		],
		['not JSON-shaped', 'nope']
	])('is 400 for %s', async (_, body) => {
		expect(isHttpError(await call(body), 400)).toBe(true);
		expect(runChat).not.toHaveBeenCalled();
	});

	it('probes an unverified model first and records the pass', async () => {
		getActiveKey.mockResolvedValue({ ...KEY, verified: false });
		expect(((await call()) as Response).status).toBe(200);
		expect(probe).toHaveBeenCalledWith({ id: 'anthropic' }, 'sk-ant-secret', 'claude-x');
		expect(setModelVerified).toHaveBeenCalledWith('u-alice', 'anthropic', 'claude-x', true);
	});

	it('is 422 when the probe finds the model unsupported, without chatting', async () => {
		getActiveKey.mockResolvedValue({ ...KEY, verified: false });
		probe.mockRejectedValueOnce(
			new UnsupportedModel('no_tools', '"claude-x" doesn\'t support tool calling.')
		);
		const res = (await call()) as Response;
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual({
			error: 'unsupported_model',
			reason: 'no_tools',
			message: '"claude-x" doesn\'t support tool calling.'
		});
		expect(runChat).not.toHaveBeenCalled();
	});

	it('clears verification when a verified model turns out unsupported mid-chat', async () => {
		runChat.mockRejectedValueOnce(new UnsupportedModel('not_found', 'gone'));
		expect(((await call()) as Response).status).toBe(422);
		expect(setModelVerified).toHaveBeenCalledWith('u-alice', 'anthropic', 'claude-x', false);
	});

	it('is 502 with the mapped message when the provider fails', async () => {
		runChat.mockRejectedValueOnce(
			new ProviderError('rate_limited', 'Claude is rate-limiting this key.')
		);
		const res = (await call()) as Response;
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body).toEqual({ error: 'rate_limited', message: 'Claude is rate-limiting this key.' });
		expect(JSON.stringify(body)).not.toContain('sk-ant-secret');
	});
});
