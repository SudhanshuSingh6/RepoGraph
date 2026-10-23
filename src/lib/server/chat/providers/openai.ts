// OpenAI's Chat Completions API, over fetch. xAI serves the same API, so xai.ts is
// this adapter with another base URL.
import type { ProviderId } from '#lib/chat/shared.ts';
import type { ChatProvider, Completion, CompleteRequest, ToolCall, Turn } from '../types.ts';
import { request } from './http.ts';

type OpenAiMessage =
	| { role: 'user'; content: string }
	| {
			role: 'assistant';
			content: string | null;
			tool_calls?: {
				id: string;
				type: 'function';
				function: { name: string; arguments: string };
			}[];
	  }
	| { role: 'tool'; tool_call_id: string; content: string };

type OpenAiResponse = {
	choices: {
		finish_reason: string | null;
		message: {
			content: string | null;
			tool_calls?: { id: string; function: { name: string; arguments: string } }[];
		};
	}[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function toOpenAiMessages(turns: Turn[]): OpenAiMessage[] {
	return turns.flatMap((t): OpenAiMessage[] => {
		if (t.role === 'user') return [{ role: 'user', content: t.text }];
		if (t.role === 'assistant') {
			return [
				{
					role: 'assistant',
					content: t.text || null,
					...(t.toolCalls?.length
						? {
								tool_calls: t.toolCalls.map((c) => ({
									id: c.id,
									type: 'function' as const,
									function: { name: c.name, arguments: JSON.stringify(c.input) }
								}))
							}
						: {})
				}
			];
		}
		return t.results.map((r) => ({
			role: 'tool' as const,
			tool_call_id: r.id,
			content: JSON.stringify(r.output)
		}));
	});
}

function parseArgs(text: string): Record<string, unknown> {
	try {
		const v = JSON.parse(text || '{}');
		return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}

export function openAiCompatible(id: ProviderId, baseUrl: string): ChatProvider {
	const api = 'Chat Completions';
	return {
		id,
		api,
		async complete(req: CompleteRequest): Promise<Completion> {
			const body = {
				model: req.model,
				messages: toOpenAiMessages(req.messages),
				max_completion_tokens: req.maxTokens,
				tools: req.tools.map((t) => ({
					type: 'function',
					function: { name: t.name, description: t.description, parameters: t.input_schema }
				})),
				tool_choice:
					typeof req.toolChoice === 'string'
						? req.toolChoice
						: { type: 'function', function: { name: req.toolChoice.name } }
			};
			const res = await request<OpenAiResponse>({
				provider: id,
				api,
				model: req.model,
				apiKey: req.apiKey,
				url: `${baseUrl}/chat/completions`,
				headers: { authorization: `Bearer ${req.apiKey}` },
				body,
				signal: req.signal
			});
			const choice = res.choices?.[0];
			const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((c) => ({
				id: c.id,
				name: c.function.name,
				input: parseArgs(c.function.arguments)
			}));
			return {
				text: choice?.message.content ?? '',
				toolCalls,
				usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 },
				truncated: choice?.finish_reason === 'length'
			};
		},
		async listModels(apiKey: string): Promise<string[]> {
			const res = await request<{ data?: { id: string }[] }>({
				provider: id,
				api,
				model: '',
				apiKey,
				url: `${baseUrl}/models`,
				headers: { authorization: `Bearer ${apiKey}` }
			});
			return (res.data ?? []).map((m) => m.id).sort();
		}
	};
}

export const openai = openAiCompatible('openai', 'https://api.openai.com/v1');
