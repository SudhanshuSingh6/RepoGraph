import type { ProviderId } from '#lib/chat/shared.ts';
import type { ChatProvider } from '../types.ts';
import { anthropic } from './anthropic.ts';
import { gemini } from './gemini.ts';
import { openai } from './openai.ts';
import { xai } from './xai.ts';

export const PROVIDER_ADAPTERS: Record<ProviderId, ChatProvider> = {
	openai,
	anthropic,
	gemini,
	xai
};
