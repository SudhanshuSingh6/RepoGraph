// Google's Gemini generateContent REST API, over fetch. The key travels in the
// x-goog-api-key header, never in the URL (URLs end up in logs).
import { unsupported, ProviderError, UnsupportedModel } from '../errors.ts';
import type {
	ChatProvider,
	Completion,
	CompleteRequest,
	ToolCall,
	ToolSpec,
	Turn
} from '../types.ts';
import { request } from './http.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const api = 'generateContent';

type Part = {
	text?: string;
	thought?: boolean;
	functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
	functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
	thoughtSignature?: string;
};
type Content = { role: 'user' | 'model'; parts: Part[] };

type GeminiResponse = {
	candidates?: { content?: Content; finishReason?: string }[];
	promptFeedback?: { blockReason?: string };
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		thoughtsTokenCount?: number;
	};
};

type GeminiModel = { name: string; supportedGenerationMethods?: string[] };

const headers = (apiKey: string) => ({ 'x-goog-api-key': apiKey });
const modelPath = (model: string) => encodeURIComponent(model.replace(/^models\//, ''));

/** Gemini's schema dialect: OpenAPI-style upper-case type names. */
function geminiSchema(schema: ToolSpec['input_schema']) {
	return {
		type: 'OBJECT',
		properties: Object.fromEntries(
			Object.entries(schema.properties).map(([k, v]) => [k, { ...v, type: v.type.toUpperCase() }])
		),
		...(schema.required?.length ? { required: schema.required } : {})
	};
}

export function toGeminiContents(turns: Turn[]): Content[] {
	return turns.map((t): Content => {
		if (t.role === 'user') return { role: 'user', parts: [{ text: t.text }] };
		if (t.role === 'assistant') {
			if (t.raw) return t.raw as Content; // keeps thought signatures for this loop
			const parts: Part[] = [];
			if (t.text) parts.push({ text: t.text });
			for (const c of t.toolCalls ?? []) {
				parts.push({ functionCall: { id: c.id, name: c.name, args: c.input } });
			}
			return { role: 'model', parts };
		}
		return {
			role: 'user',
			parts: t.results.map((r) => ({
				functionResponse: {
					...(r.id.startsWith('gemini-') ? {} : { id: r.id }),
					name: r.name,
					response:
						r.output && typeof r.output === 'object' && !Array.isArray(r.output)
							? (r.output as Record<string, unknown>)
							: { result: r.output }
				}
			}))
		};
	});
}

/** Gemini's 404 reads "not found … or is not supported for generateContent" either way,
 * so look the model up to tell the two apart. */
async function explainMissing(
	apiKey: string,
	model: string,
	original: UnsupportedModel
): Promise<UnsupportedModel> {
	try {
		const info = await request<GeminiModel>({
			provider: 'gemini',
			api,
			model,
			apiKey,
			url: `${BASE}/models/${modelPath(model)}`,
			headers: headers(apiKey)
		});
		if (!info.supportedGenerationMethods?.includes('generateContent')) {
			return unsupported('wrong_endpoint', 'gemini', model, api);
		}
		return original;
	} catch {
		return unsupported('not_found', 'gemini', model, api);
	}
}

export const gemini: ChatProvider = {
	id: 'gemini',
	api,
	async complete(req: CompleteRequest): Promise<Completion> {
		const mode = req.toolChoice === 'auto' ? 'AUTO' : req.toolChoice === 'none' ? 'NONE' : 'ANY';
		const body = {
			contents: toGeminiContents(req.messages),
			tools: [
				{
					functionDeclarations: req.tools.map((t) => ({
						name: t.name,
						description: t.description,
						...(Object.keys(t.input_schema.properties).length
							? { parameters: geminiSchema(t.input_schema) }
							: {})
					}))
				}
			],
			toolConfig: {
				functionCallingConfig: {
					mode,
					...(typeof req.toolChoice === 'object'
						? { allowedFunctionNames: [req.toolChoice.name] }
						: {})
				}
			},
			generationConfig: { maxOutputTokens: req.maxTokens }
		};
		let res: GeminiResponse;
		try {
			res = await request<GeminiResponse>({
				provider: 'gemini',
				api,
				model: req.model,
				apiKey: req.apiKey,
				url: `${BASE}/models/${modelPath(req.model)}:generateContent`,
				headers: headers(req.apiKey),
				body,
				signal: req.signal
			});
		} catch (e) {
			if (e instanceof UnsupportedModel && e.reason !== 'no_tools') {
				throw await explainMissing(req.apiKey, req.model, e);
			}
			throw e;
		}
		const candidate = res.candidates?.[0];
		if (!candidate?.content) {
			const why = res.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no answer';
			throw new ProviderError('provider', `Gemini returned no answer (${why}).`);
		}
		const parts = candidate.content.parts ?? [];
		const toolCalls: ToolCall[] = parts.flatMap((p, i) =>
			p.functionCall
				? [
						{
							id: p.functionCall.id ?? `gemini-${i}`,
							name: p.functionCall.name,
							input: p.functionCall.args ?? {}
						}
					]
				: []
		);
		const u = res.usageMetadata ?? {};
		return {
			text: parts
				.filter((p) => p.text && !p.thought)
				.map((p) => p.text)
				.join(''),
			toolCalls,
			usage: {
				input: u.promptTokenCount ?? 0,
				output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)
			},
			truncated: candidate.finishReason === 'MAX_TOKENS',
			raw: { role: 'model', parts }
		};
	},
	async listModels(apiKey: string): Promise<string[]> {
		const names: string[] = [];
		let pageToken = '';
		for (let page = 0; page < 5; page++) {
			const res = await request<{ models?: GeminiModel[]; nextPageToken?: string }>({
				provider: 'gemini',
				api,
				model: '',
				apiKey,
				url: `${BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
				headers: headers(apiKey)
			});
			for (const m of res.models ?? []) names.push(m.name.replace(/^models\//, ''));
			if (!res.nextPageToken) break;
			pageToken = res.nextPageToken;
		}
		return names.sort();
	}
};
