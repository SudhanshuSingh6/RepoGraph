import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatProvider, Completion, CompleteRequest } from './types.ts';

const readProjectFile = vi.fn();
vi.mock('#lib/server/fileStorage.ts', () => ({ readProjectFile }));

const { MAX_ROUNDS, runChat } = await import('./converse.ts');
const { CONTEXT_ACK } = await import('./context.ts');
const { ProviderError, UnsupportedModel } = await import('./errors.ts');
const { probe } = await import('./probe.ts');
const { chatRepo } = await import('./fixture.ts');

const done = (text: string, extra: Partial<Completion> = {}): Completion => ({
	text,
	toolCalls: [],
	usage: { input: 10, output: 5 },
	truncated: false,
	...extra
});

/** A provider that answers from a script and records every request. */
function fake(script: Completion[]) {
	const requests: CompleteRequest[] = [];
	const provider: ChatProvider = {
		id: 'anthropic',
		api: 'Messages',
		async complete(req) {
			requests.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })));
			return script.shift() ?? done('fallback');
		},
		listModels: async () => []
	};
	return { provider, requests };
}

const run = (provider: ChatProvider) =>
	runChat({
		provider,
		apiKey: 'k',
		model: 'm',
		repo: chatRepo(),
		history: [{ role: 'user', content: 'What does b do?' }]
	});

beforeEach(() => {
	readProjectFile.mockReset();
	readProjectFile.mockResolvedValue('export const b = 1;');
});

describe('runChat', () => {
	it('primes with the context turn, runs a tool call and returns the answer', async () => {
		const { provider, requests } = fake([
			done('Let me look.', {
				toolCalls: [{ id: 't1', name: 'getFile', input: { path: 'web/b.ts' } }]
			}),
			done('It exports b.')
		]);
		const result = await run(provider);

		expect(result).toEqual({
			reply: 'It exports b.',
			toolCalls: [{ name: 'getFile', input: { path: 'web/b.ts' } }],
			filesRead: ['web/b.ts'],
			usage: { input: 20, output: 10 }
		});
		const [first, second] = requests;
		expect(first.messages[0]).toMatchObject({ role: 'user' });
		expect((first.messages[0] as { text: string }).text).toMatch(/^You are a code-exploration/);
		expect(first.messages[1]).toEqual({ role: 'assistant', text: CONTEXT_ACK });
		expect(first.messages[2]).toEqual({ role: 'user', text: 'What does b do?' });
		expect(first.tools.map((t) => t.name)).toEqual(['getFile', 'searchFiles', 'listChildren']);
		expect(first.toolChoice).toBe('auto');
		// The tool result goes back, matched to its call.
		expect(second.messages.at(-1)).toMatchObject({
			role: 'tool',
			results: [
				{ id: 't1', name: 'getFile', output: { path: 'web/b.ts', source: 'export const b = 1;' } }
			]
		});
	});

	it('forces an answer on the last round', async () => {
		const call = { id: 't', name: 'searchFiles', input: { query: 'a' } };
		const { provider, requests } = fake(
			Array.from({ length: MAX_ROUNDS }, (_, i) =>
				i < MAX_ROUNDS - 1 ? done('', { toolCalls: [call] }) : done('Best guess.')
			)
		);
		expect((await run(provider)).reply).toBe('Best guess.');
		expect(requests).toHaveLength(MAX_ROUNDS);
		expect(requests.at(-1)!.toolChoice).toBe('none');
	});

	it('treats an empty answer as a provider failure', async () => {
		const { provider } = fake([done('  ', { truncated: true })]);
		await expect(run(provider)).rejects.toBeInstanceOf(ProviderError);
	});
});

describe('probe', () => {
	it('forces the ping tool and passes when it is called', async () => {
		const { provider, requests } = fake([
			done('', { toolCalls: [{ id: 'p', name: 'ping', input: {} }] })
		]);
		await probe(provider, 'k', 'm');
		expect(requests[0].toolChoice).toEqual({ name: 'ping' });
		expect(requests[0].tools.map((t) => t.name)).toEqual(['ping']);
	});

	it('fails as no_tools when the model answers in text instead', async () => {
		const { provider } = fake([done('pong')]);
		await expect(probe(provider, 'k', 'm')).rejects.toMatchObject({
			constructor: UnsupportedModel,
			reason: 'no_tools'
		});
	});
});
