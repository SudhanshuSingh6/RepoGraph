// xAI (Grok) serves the OpenAI Chat Completions API.
import { openAiCompatible } from './openai.ts';

export const xai = openAiCompatible('xai', 'https://api.x.ai/v1');
