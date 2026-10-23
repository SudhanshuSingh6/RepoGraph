import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, UnsupportedModel } from '../errors.ts';
import { probe } from '../probe.ts';
import type { CompleteRequest, Turn } from '../types.ts';
import { anthropic } from './anthropic.ts';
import { gemini } from './gemini.ts';
import { openai } from './openai.ts';
import { xai } from './xai.ts';

const KEY = 'sk-test-0123456789abcdef';

type Reply = { status?: number; body: unknown };
let replies: Reply[] = [];
let calls: { url: string; init: RequestInit; body: Record<string, unknown> | null }[] = [];

beforeEach(() => {
	replies = [];
	calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			const raw = init.body ?? (input instanceof Request ? await input.text() : null);
			calls.push({ url, init, body: raw ? JSON.parse(String(raw)) : null });
			const r = replies.shift() ?? { body: {} };
			return new Response(JSON.stringify(r.body), {
				status: r.status ?? 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
});

afterEach(() => vi.unstubAllGlobals());

const header = (i: number, name: string) => new Headers(calls[i].init.headers).get(name);

// One tool loop in flight: question, a call, its result.
const MESSAGES: Turn[] = [
	{ role: 'user', text: 'What does b do?' },
	{
		role: 'assistant',
		text: 'Looking.',
		toolCalls: [{ id: 'c1', name: 'getFile', input: { path: 'b.ts' } }]
	},
	{ role: 'tool', results: [{ id: 'c1', name: 'getFile', output: { source: 'x' } }] }
];
const TOOL = {
	name: 'getFile',
	description: 'Reads a file.',
	input_schema: {
		type: 'object' as const,
		properties: { path: { type: 'string' } },
		required: ['path']
	}
};
const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({
	apiKey: KEY,
	model: 'm-1',
	messages: MESSAGES,
	tools: [TOOL],
	toolChoice: 'auto',
	maxTokens: 100,
	...over
});

describe('OpenAI (and xAI) adapter', () => {
	it('maps the conversation, tools and tool results to Chat Completions', async () => {
		replies.push({
			body: {
				choices: [
					{
						finish_reason: 'tool_calls',
						message: {
							content: null,
							tool_calls: [
								{ id: 'c2', function: { name: 'searchFiles', arguments: '{"query":"a"}' } }
							]
						}
					}
				],
				usage: { prompt_tokens: 50, completion_tokens: 7 }
			}
		});
		const res = await openai.complete(req());
		expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
		expect(header(0, 'authorization')).toBe(`Bearer ${KEY}`);
		expect(calls[0].body).toEqual({
			model: 'm-1',
			max_completion_tokens: 100,
			tool_choice: 'auto',
			tools: [
				{
					type: 'function',
					function: { name: 'getFile', description: 'Reads a file.', parameters: TOOL.input_schema }
				}
			],
			messages: [
				{ role: 'user', content: 'What does b do?' },
				{
					role: 'assistant',
					content: 'Looking.',
					tool_calls: [
						{
							id: 'c1',
							type: 'function',
							function: { name: 'getFile', arguments: '{"path":"b.ts"}' }
						}
					]
				},
				{ role: 'tool', tool_call_id: 'c1', content: '{"source":"x"}' }
			]
		});
		expect(res).toEqual({
			text: '',
			toolCalls: [{ id: 'c2', name: 'searchFiles', input: { query: 'a' } }],
			usage: { input: 50, output: 7 },
			truncated: false
		});
	});

	it('forces a named tool, and xAI uses its own base URL', async () => {
		replies.push({ body: { choices: [{ message: { content: 'hi' } }] } });
		await xai.complete(req({ toolChoice: { name: 'getFile' } }));
		expect(calls[0].url).toBe('https://api.x.ai/v1/chat/completions');
		expect(calls[0].body!.tool_choice).toEqual({ type: 'function', function: { name: 'getFile' } });
	});

	it('maps errors without echoing the key', async () => {
		replies.push({
			status: 401,
			body: { error: { message: `Incorrect API key provided: ${KEY}` } }
		});
		const e = await openai.complete(req()).catch((x) => x);
		expect(e).toBeInstanceOf(ProviderError);
		expect(e.kind).toBe('key_rejected');
		expect(e.message).not.toContain(KEY);

		replies.push({ status: 429, body: { error: { message: 'Rate limit reached' } } });
		expect(await openai.complete(req()).catch((x) => x.kind)).toBe('rate_limited');

		replies.push({ status: 500, body: { error: { message: `boom ${KEY}` } } });
		const server = await openai.complete(req()).catch((x) => x);
		expect(server.kind).toBe('provider');
		expect(server.message).not.toContain(KEY);
	});

	it('lists models with the key', async () => {
		replies.push({ body: { data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] } });
		expect(await openai.listModels(KEY)).toEqual(['gpt-a', 'gpt-b']);
		expect(calls[0].url).toBe('https://api.openai.com/v1/models');
	});
});

describe('Anthropic adapter', () => {
	it('maps to the Messages API with tool_use / tool_result blocks', async () => {
		replies.push({
			body: {
				id: 'msg',
				type: 'message',
				role: 'assistant',
				model: 'm-1',
				content: [
					{ type: 'text', text: 'Reading.' },
					{ type: 'tool_use', id: 'c2', name: 'listChildren', input: { path: '' } }
				],
				stop_reason: 'tool_use',
				usage: { input_tokens: 40, output_tokens: 9 }
			}
		});
		const res = await anthropic.complete(req({ toolChoice: 'none' }));
		expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
		expect(header(0, 'x-api-key')).toBe(KEY);
		expect(calls[0].body).toMatchObject({
			model: 'm-1',
			max_tokens: 100,
			tool_choice: { type: 'none' },
			tools: [{ name: 'getFile', description: 'Reads a file.', input_schema: TOOL.input_schema }],
			messages: [
				{ role: 'user', content: 'What does b do?' },
				{
					role: 'assistant',
					content: [
						{ type: 'text', text: 'Looking.' },
						{ type: 'tool_use', id: 'c1', name: 'getFile', input: { path: 'b.ts' } }
					]
				},
				{
					role: 'user',
					content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"source":"x"}' }]
				}
			]
		});
		expect(res).toEqual({
			text: 'Reading.',
			toolCalls: [{ id: 'c2', name: 'listChildren', input: { path: '' } }],
			usage: { input: 40, output: 9 },
			truncated: false
		});
	});

	it('maps an unknown model to not_found and a bad key to key_rejected', async () => {
		replies.push({
			status: 404,
			body: { type: 'error', error: { type: 'not_found_error', message: 'model: m-1' } }
		});
		expect(await anthropic.complete(req()).catch((x) => x)).toMatchObject({
			constructor: UnsupportedModel,
			reason: 'not_found'
		});
		replies.push({
			status: 401,
			body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }
		});
		expect(await anthropic.listModels(KEY).catch((x) => x.kind)).toBe('key_rejected');
	});
});

describe('Gemini adapter', () => {
	it('sends the key in a header, never the URL, and maps function calls', async () => {
		replies.push({
			body: {
				candidates: [
					{
						finishReason: 'STOP',
						content: {
							role: 'model',
							parts: [
								{ text: 'thinking…', thought: true },
								{
									functionCall: { name: 'getFile', args: { path: 'a.ts' } },
									thoughtSignature: 'sig'
								}
							]
						}
					}
				],
				usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 6 }
			}
		});
		const res = await gemini.complete(req({ toolChoice: { name: 'getFile' } }));
		expect(calls[0].url).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent'
		);
		expect(calls[0].url).not.toContain(KEY);
		expect(header(0, 'x-goog-api-key')).toBe(KEY);
		expect(calls[0].body).toEqual({
			contents: [
				{ role: 'user', parts: [{ text: 'What does b do?' }] },
				{
					role: 'model',
					parts: [
						{ text: 'Looking.' },
						{ functionCall: { id: 'c1', name: 'getFile', args: { path: 'b.ts' } } }
					]
				},
				{
					role: 'user',
					parts: [{ functionResponse: { id: 'c1', name: 'getFile', response: { source: 'x' } } }]
				}
			],
			tools: [
				{
					functionDeclarations: [
						{
							name: 'getFile',
							description: 'Reads a file.',
							parameters: {
								type: 'OBJECT',
								properties: { path: { type: 'STRING' } },
								required: ['path']
							}
						}
					]
				}
			],
			toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['getFile'] } },
			generationConfig: { maxOutputTokens: 100 }
		});
		expect(res).toMatchObject({
			text: '',
			toolCalls: [{ id: 'gemini-1', name: 'getFile', input: { path: 'a.ts' } }],
			usage: { input: 30, output: 10 }
		});
	});

	it('replays its own turn (thought signatures) within the loop', async () => {
		const raw = {
			role: 'model',
			parts: [{ functionCall: { name: 'getFile', args: {} }, thoughtSignature: 'sig' }]
		};
		replies.push({
			body: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }
		});
		await gemini.complete(
			req({
				messages: [
					{ role: 'user', text: 'q' },
					{
						role: 'assistant',
						text: '',
						toolCalls: [{ id: 'gemini-0', name: 'getFile', input: {} }],
						raw
					},
					{ role: 'tool', results: [{ id: 'gemini-0', name: 'getFile', output: ['a'] }] }
				]
			})
		);
		const contents = calls[0].body!.contents as unknown[];
		expect(contents[1]).toEqual(raw);
		// Synthetic ids aren't sent back; non-object outputs are wrapped.
		expect(contents[2]).toEqual({
			role: 'user',
			parts: [{ functionResponse: { name: 'getFile', response: { result: ['a'] } } }]
		});
	});

	it('tells a missing model from one that is not a generateContent model', async () => {
		const notFound = {
			status: 404,
			body: {
				error: {
					message:
						'models/x is not found for API version v1beta, or is not supported for generateContent.'
				}
			}
		};
		replies.push(notFound, { status: 404, body: { error: { message: 'not found' } } });
		expect(await gemini.complete(req()).catch((x) => x.reason)).toBe('not_found');

		replies.push(notFound, {
			body: { name: 'models/x', supportedGenerationMethods: ['embedContent'] }
		});
		expect(await gemini.complete(req()).catch((x) => x.reason)).toBe('wrong_endpoint');
		expect(calls.at(-1)!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/m-1');
	});

	it('maps an invalid key (a 400 from Gemini) to key_rejected', async () => {
		replies.push({
			status: 400,
			body: { error: { message: 'API key not valid. Please pass a valid API key.' } }
		});
		expect(await gemini.listModels(KEY).catch((x) => x.kind)).toBe('key_rejected');
		expect(calls[0].url).not.toContain(KEY);
	});
});

describe('probe through a real adapter', () => {
	it('passes when the forced ping call comes back', async () => {
		replies.push({
			body: {
				choices: [
					{
						message: {
							content: null,
							tool_calls: [{ id: 'p', function: { name: 'ping', arguments: '{}' } }]
						}
					}
				]
			}
		});
		await expect(probe(openai, KEY, 'gpt-x')).resolves.toBeUndefined();
		expect(calls[0].body!.tool_choice).toEqual({ type: 'function', function: { name: 'ping' } });
	});

	it.each([
		['not_found', 404, 'The model `gpt-x` does not exist or you do not have access to it.'],
		[
			'wrong_endpoint',
			404,
			'This is not a chat model and thus not supported in the v1/chat/completions endpoint.'
		],
		[
			'wrong_endpoint',
			400,
			'This model is only supported in v1/responses and not in v1/chat/completions.'
		],
		['no_tools', 400, "'tools' is not supported with this model."]
	])('reports %s from a %i "%s"', async (reason, status, message) => {
		replies.push({ status, body: { error: { message } } });
		const e = await probe(openai, KEY, 'gpt-x').catch((x) => x);
		expect(e).toBeInstanceOf(UnsupportedModel);
		expect(e.reason).toBe(reason);
		expect(e.message).toContain('gpt-x');
	});

	it('reports no_tools when the model answers in text despite the forced call', async () => {
		replies.push({ body: { choices: [{ finish_reason: 'stop', message: { content: 'pong' } }] } });
		expect(await probe(openai, KEY, 'gpt-x').catch((x) => x.reason)).toBe('no_tools');
	});
});
