// The provider-neutral tool loop: ask, run whatever tools the model calls, feed the
// results back, until it answers in text.
import type { ChatTurn } from '#lib/chat/shared.ts';
import { buildChatContext, CONTEXT_ACK } from './context.ts';
import { ProviderError } from './errors.ts';
import type { ChatRepo } from './repo.ts';
import { runTool, TOOLS } from './tools.ts';
import type { ChatProvider, Turn, Usage } from './types.ts';

export const MAX_ROUNDS = 8;
export const MAX_OUTPUT_TOKENS = 4096;

export type ChatResult = {
	reply: string;
	toolCalls: { name: string; input: Record<string, unknown> }[];
	filesRead: string[];
	usage: Usage;
};

export async function runChat(opts: {
	provider: ChatProvider;
	apiKey: string;
	model: string;
	repo: ChatRepo;
	history: ChatTurn[];
	signal?: AbortSignal;
}): Promise<ChatResult> {
	const { provider, apiKey, model, repo } = opts;
	const messages: Turn[] = [
		{ role: 'user', text: buildChatContext(repo) },
		{ role: 'assistant', text: CONTEXT_ACK },
		...opts.history.map((t): Turn =>
			t.role === 'user' ? { role: 'user', text: t.content } : { role: 'assistant', text: t.content }
		)
	];
	const usage: Usage = { input: 0, output: 0 };
	const toolCalls: ChatResult['toolCalls'] = [];
	const filesRead: string[] = [];

	for (let round = 1; ; round++) {
		const res = await provider.complete({
			apiKey,
			model,
			messages,
			tools: TOOLS,
			// The last round must answer with what it has.
			toolChoice: round === MAX_ROUNDS ? 'none' : 'auto',
			maxTokens: MAX_OUTPUT_TOKENS,
			signal: opts.signal
		});
		usage.input += res.usage.input;
		usage.output += res.usage.output;
		if (res.toolCalls.length === 0 || round === MAX_ROUNDS) {
			const reply = res.text.trim();
			if (!reply) {
				throw new ProviderError(
					'provider',
					res.truncated
						? 'The model used up its output budget before answering. Try a narrower question.'
						: 'The model returned an empty answer. Try again.'
				);
			}
			return { reply, toolCalls, filesRead, usage };
		}
		messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw });
		const results = [];
		for (const call of res.toolCalls) {
			const output = await runTool(call.name, call.input, repo);
			toolCalls.push({ name: call.name, input: call.input });
			if (call.name === 'getFile' && output && typeof output === 'object' && 'source' in output) {
				const path = (output as unknown as { path: string }).path;
				if (!filesRead.includes(path)) filesRead.push(path);
			}
			results.push({ id: call.id, name: call.name, output });
		}
		messages.push({ role: 'tool', results });
	}
}
