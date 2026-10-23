import { error, json } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards.ts';
import { getKey } from '#lib/server/chat/keys.ts';
import { PROVIDER_ADAPTERS } from '#lib/server/chat/providers/index.ts';
import { failure, providerOf, readBody, requireChat } from '#lib/server/chat/settings.ts';
import type { RequestHandler } from './$types';

/** Model suggestions for a provider, listed with the key being entered or, without
 * one, the key already saved. Not every listed model works here: saving probes it. */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	requireChat();
	const body = await readBody(event.request);
	const provider = providerOf(body);
	let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
	if (!apiKey) {
		const saved = await getKey(user.id, provider);
		if (!saved) error(400, 'Enter an API key first.');
		apiKey = saved.apiKey;
	}
	try {
		return json({ models: await PROVIDER_ADAPTERS[provider].listModels(apiKey) });
	} catch (e) {
		return failure(e);
	}
};
