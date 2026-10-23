// The provider-neutral conversation the chat loop works in. Each adapter in
// providers/ maps it to its API's wire format and back.
import type { ProviderId } from '#lib/chat/shared.ts';

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type Turn =
	| { role: 'user'; text: string }
	// `raw` is the provider's own copy of the turn, replayed verbatim within the same
	// tool loop when the API needs more than text and calls (Gemini's thought signatures).
	| { role: 'assistant'; text: string; toolCalls?: ToolCall[]; raw?: unknown }
	| { role: 'tool'; results: { id: string; name: string; output: unknown }[] };

/** A tool as every adapter sees it: a JSON-schema object for its input. */
export type ToolSpec = {
	name: string;
	description: string;
	input_schema: {
		type: 'object';
		properties: Record<string, { type: string; description?: string }>;
		required?: string[];
	};
};

export type ToolChoice = 'auto' | 'none' | { name: string };

export type Usage = { input: number; output: number };

export type CompleteRequest = {
	apiKey: string;
	model: string;
	messages: Turn[];
	tools: ToolSpec[];
	toolChoice: ToolChoice;
	maxTokens: number;
	signal?: AbortSignal;
};

export type Completion = {
	text: string;
	toolCalls: ToolCall[];
	usage: Usage;
	/** The output was cut off by the token limit. */
	truncated: boolean;
	raw?: unknown;
};

export interface ChatProvider {
	id: ProviderId;
	/** The API this adapter speaks, for "isn't served by the … API" messages. */
	api: string;
	/** One round: a single request, no tool execution. */
	complete(req: CompleteRequest): Promise<Completion>;
	listModels(apiKey: string): Promise<string[]>;
}

/** Per request to a provider. */
export const TIMEOUT_MS = 60_000;
