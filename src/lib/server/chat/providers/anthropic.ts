// Anthropic's Messages API, through the official SDK.
import Anthropic from '@anthropic-ai/sdk';
import { classify, networkError } from '../errors.ts';
import {
	TIMEOUT_MS,
	type ChatProvider,
	type Completion,
	type CompleteRequest,
	type Turn
} from '../types.ts';

const api = 'Messages';

// The SDK's retries would stretch a request past the timeout the route promises.
const client = (apiKey: string) => new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });

export function toAnthropicMessages(turns: Turn[]): Anthropic.MessageParam[] {
	return turns.map((t): Anthropic.MessageParam => {
		if (t.role === 'user') return { role: 'user', content: t.text };
		if (t.role === 'assistant') {
			const content: Anthropic.ContentBlockParam[] = [];
			if (t.text) content.push({ type: 'text', text: t.text });
			for (const c of t.toolCalls ?? []) {
				content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
			}
			return { role: 'assistant', content };
		}
		return {
			role: 'user',
			content: t.results.map((r) => ({
				type: 'tool_result' as const,
				tool_use_id: r.id,
				content: JSON.stringify(r.output)
			}))
		};
	});
}

/** SDK errors carry the status and the API's JSON body. */
function rethrow(e: unknown, model: string, apiKey: string): never {
	if (e instanceof Anthropic.APIError && typeof e.status === 'number') {
		const body = e.error as { error?: { message?: string } } | undefined;
		throw classify('anthropic', api, model, e.status, body?.error?.message ?? e.message, apiKey);
	}
	if (e instanceof Anthropic.APIConnectionTimeoutError) {
		throw networkError('anthropic', Object.assign(new Error(), { name: 'TimeoutError' }));
	}
	throw networkError('anthropic', e);
}

export const anthropic: ChatProvider = {
	id: 'anthropic',
	api,
	async complete(req: CompleteRequest): Promise<Completion> {
		let res: Anthropic.Message;
		try {
			res = await client(req.apiKey).messages.create(
				{
					model: req.model,
					max_tokens: req.maxTokens,
					messages: toAnthropicMessages(req.messages),
					tools: req.tools.map((t) => ({
						name: t.name,
						description: t.description,
						input_schema: t.input_schema
					})),
					tool_choice:
						req.toolChoice === 'auto'
							? { type: 'auto' }
							: req.toolChoice === 'none'
								? { type: 'none' }
								: { type: 'tool', name: req.toolChoice.name }
				},
				{ signal: req.signal }
			);
		} catch (e) {
			rethrow(e, req.model, req.apiKey);
		}
		const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
		const toolCalls = res.content.flatMap((b) =>
			b.type === 'tool_use'
				? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }]
				: []
		);
		return {
			text,
			toolCalls,
			usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
			truncated: res.stop_reason === 'max_tokens'
		};
	},
	async listModels(apiKey: string): Promise<string[]> {
		try {
			const ids: string[] = [];
			for await (const m of client(apiKey).models.list({ limit: 1000 })) ids.push(m.id);
			return ids;
		} catch (e) {
			rethrow(e, '', apiKey);
		}
	}
};
