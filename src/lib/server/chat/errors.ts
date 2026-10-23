// Provider failures, mapped to short messages that never echo the key.
import { PROVIDER_NAMES, type ProviderId, type UnsupportedReason } from '#lib/chat/shared.ts';

export type FailureKind = 'key_rejected' | 'rate_limited' | 'timeout' | 'provider';

export class ProviderError extends Error {
	constructor(
		readonly kind: FailureKind,
		message: string
	) {
		super(message);
	}
}

/** The model can't be used by this app: unknown, not served by the adapter's
 * endpoint, or without tool calling. */
export class UnsupportedModel extends Error {
	constructor(
		readonly reason: UnsupportedReason,
		message: string
	) {
		super(message);
	}
}

export function unsupported(
	reason: UnsupportedReason,
	provider: ProviderId,
	model: string,
	api: string
): UnsupportedModel {
	const name = PROVIDER_NAMES[provider];
	switch (reason) {
		case 'not_found':
			return new UnsupportedModel(reason, `Model "${model}" wasn't found for this ${name} key.`);
		case 'wrong_endpoint':
			return new UnsupportedModel(
				reason,
				`"${model}" isn't a chat model this app can use with ${name} (it isn't served by the ${api} API).`
			);
		case 'no_tools':
			return new UnsupportedModel(
				reason,
				`"${model}" doesn't support tool calling, which this chat needs to read files.`
			);
	}
}

/** Strips anything key-shaped from provider text before it is shown or logged. */
export function redact(text: string, apiKey: string): string {
	let out = apiKey ? text.split(apiKey).join('[key]') : text;
	out = out.replace(/\b(sk-|xai-|AIza)[\w-]{6,}/g, '[key]');
	return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

const ENDPOINT =
	/not a chat model|only supported in v1\/responses|not supported in the v1\/chat\/completions|v1\/completions|not supported for generatecontent|does not support (chat|generatecontent|messages)|is not supported for this (api|endpoint)/i;
const TOOLS = /\btools?\b|function[ _]?call|functions? (is|are) not|tool_choice/i;
const KEY = /api[ _-]?key|incorrect key|invalid key|unauthori[sz]ed|authentication/i;
const MISSING = /does not exist|not found|unknown model|invalid model|no such model/i;

/**
 * Turns a failed HTTP response into a typed error. Shared by every adapter: the
 * providers' messages differ, so this reads the status first and the text second.
 */
export function classify(
	provider: ProviderId,
	api: string,
	model: string,
	status: number,
	message: string,
	apiKey: string
): ProviderError | UnsupportedModel {
	const name = PROVIDER_NAMES[provider];
	const detail = redact(message, apiKey);
	if (status === 401 || status === 403 || (status === 400 && KEY.test(message))) {
		return new ProviderError('key_rejected', `That key was rejected by ${name}.`);
	}
	if (status === 429) {
		return new ProviderError(
			'rate_limited',
			`${name} is rate-limiting this key (or its credit ran out). Try again shortly.`
		);
	}
	if (status === 400 || status === 404 || status === 422) {
		if (ENDPOINT.test(message)) return unsupported('wrong_endpoint', provider, model, api);
		if (TOOLS.test(message)) return unsupported('no_tools', provider, model, api);
		if (status === 404 || MISSING.test(message)) {
			return unsupported('not_found', provider, model, api);
		}
	}
	return new ProviderError(
		'provider',
		`${name} returned an error (${status})${detail ? `: ${detail}` : '.'}`
	);
}

export function networkError(provider: ProviderId, e: unknown): ProviderError {
	const name = PROVIDER_NAMES[provider];
	if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
		return new ProviderError('timeout', `${name} took too long to answer. Try again.`);
	}
	return new ProviderError('provider', `Couldn't reach ${name}. Try again.`);
}
