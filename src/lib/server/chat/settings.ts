// Shared by the /api/chat/* routes: body parsing and the error responses.
import { error, json } from '@sveltejs/kit';
import { isProvider, type ProviderId } from '#lib/chat/shared.ts';
import { ProviderError, UnsupportedModel } from './errors.ts';
import { chatAvailable } from './keys.ts';

export function requireChat() {
	if (!chatAvailable()) error(503, 'Chat is currently unavailable.');
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'Send a JSON object.');
	return body as Record<string, unknown>;
}

export function providerOf(body: Record<string, unknown>): ProviderId {
	if (!isProvider(body.provider)) error(400, 'Pick a provider: openai, anthropic, gemini or xai.');
	return body.provider;
}

export function stringOf(body: Record<string, unknown>, field: string, label: string): string {
	const v = body[field];
	if (typeof v !== 'string' || !v.trim() || v.length > 500) error(400, `Enter ${label}.`);
	return v.trim();
}

/** Provider failures as JSON the settings form can show next to the right field. */
export function failure(e: unknown): Response {
	if (e instanceof UnsupportedModel) {
		return json(
			{ error: 'unsupported_model', reason: e.reason, message: e.message },
			{ status: 422 }
		);
	}
	if (e instanceof ProviderError) {
		return json(
			{ error: e.kind, message: e.message },
			{ status: e.kind === 'key_rejected' ? 400 : 502 }
		);
	}
	throw e;
}
