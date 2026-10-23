// The fetch-based adapters' one way to call an API: a timeout on every request, and
// failures turned into typed errors by errors.ts.
import type { ProviderId } from '#lib/chat/shared.ts';
import { classify, networkError } from '../errors.ts';
import { TIMEOUT_MS } from '../types.ts';

type Call = {
	provider: ProviderId;
	api: string;
	model: string;
	apiKey: string;
	url: string;
	headers: Record<string, string>;
	body?: unknown;
	signal?: AbortSignal;
};

/** The error text in any of the providers' error-body shapes. */
export function errorMessage(body: unknown, fallback: string): string {
	if (body && typeof body === 'object') {
		const b = body as Record<string, unknown>;
		const err = b.error;
		if (typeof err === 'string') return err;
		if (
			err &&
			typeof err === 'object' &&
			typeof (err as { message?: unknown }).message === 'string'
		) {
			return (err as { message: string }).message;
		}
		if (typeof b.message === 'string') return b.message;
	}
	return fallback;
}

export async function request<T>(call: Call): Promise<T> {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	let res: Response;
	try {
		res = await fetch(call.url, {
			method: call.body === undefined ? 'GET' : 'POST',
			headers: {
				...(call.body === undefined ? {} : { 'content-type': 'application/json' }),
				...call.headers
			},
			body: call.body === undefined ? undefined : JSON.stringify(call.body),
			signal: call.signal ? AbortSignal.any([call.signal, timeout]) : timeout
		});
	} catch (e) {
		throw networkError(call.provider, e);
	}
	const text = await res.text().catch(() => '');
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// not JSON: the raw text is the message
	}
	if (!res.ok) {
		throw classify(
			call.provider,
			call.api,
			call.model,
			res.status,
			errorMessage(json, text),
			call.apiKey
		);
	}
	return json as T;
}
