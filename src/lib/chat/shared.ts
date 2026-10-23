// Chat types shared by the server routes and the chat panel (no server imports).

export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'xai'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
	openai: 'OpenAI',
	anthropic: 'Claude',
	gemini: 'Gemini',
	xai: 'Grok'
};

export const isProvider = (v: unknown): v is ProviderId =>
	typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);

/** A saved key as the browser sees it: never the key itself, only its last characters. */
export type SavedKey = {
	provider: ProviderId;
	hint: string;
	model: string;
	verified: boolean;
	active: boolean;
};

export type UnsupportedReason = 'not_found' | 'wrong_endpoint' | 'no_tools';

/** One visible turn of the conversation, as sent to /api/projects/:id/chat. */
export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ChatReply = {
	reply: string;
	toolCalls: { name: string; input: Record<string, unknown> }[];
	filesRead: string[];
	usage: { input: number; output: number };
	provider: ProviderId;
	model: string;
};

/** Request limits, checked by the route and mirrored by the panel. */
export const MAX_TURNS = 40;
export const MAX_TURN_CHARS = 8000;
