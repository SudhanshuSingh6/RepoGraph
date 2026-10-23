// Before a model is used: one minimal request on the same endpoint and wire format
// the chat uses, forcing a call to a trivial tool. A model that appears in a
// provider's model list may still be served by another API or lack tool calling.
import { ProviderError, unsupported } from './errors.ts';
import type { ChatProvider, ToolSpec } from './types.ts';

const PING: ToolSpec = {
	name: 'ping',
	description: 'Confirms the connection. Call it with no arguments.',
	input_schema: { type: 'object', properties: {} }
};

// Reasoning models spend output tokens before the call, so leave them room.
const PROBE_TOKENS = 1024;

/** Resolves if `model` works for chat; throws UnsupportedModel or ProviderError. */
export async function probe(provider: ChatProvider, apiKey: string, model: string): Promise<void> {
	const res = await provider.complete({
		apiKey,
		model,
		messages: [{ role: 'user', text: 'Call the ping tool.' }],
		tools: [PING],
		toolChoice: { name: PING.name },
		maxTokens: PROBE_TOKENS
	});
	if (res.toolCalls.some((c) => c.name === PING.name)) return;
	if (res.truncated) {
		throw new ProviderError('provider', 'The model ran out of tokens during the check. Try again.');
	}
	throw unsupported('no_tools', provider.id, model, provider.api);
}
