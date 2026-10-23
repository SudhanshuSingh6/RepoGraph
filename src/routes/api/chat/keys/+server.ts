import { error, json } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards.ts';
import {
	deleteKey,
	getKey,
	listKeys,
	saveKey,
	setActive,
	setModel
} from '#lib/server/chat/keys.ts';
import { probe } from '#lib/server/chat/probe.ts';
import { PROVIDER_ADAPTERS } from '#lib/server/chat/providers/index.ts';
import { failure, providerOf, readBody, requireChat, stringOf } from '#lib/server/chat/settings.ts';
import type { RequestHandler } from './$types';

// The signed-in user's chat keys. Responses list keys by provider, hint and model;
// the key itself never comes back.

const keys = async (userId: string) => json({ keys: await listKeys(userId) });

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	requireChat();
	return keys(user.id);
};

/** Saves a key: the key must list models, and the model must pass the probe. Nothing
 * is stored otherwise. The saved provider becomes the active one. */
export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	requireChat();
	const body = await readBody(event.request);
	const provider = providerOf(body);
	const apiKey = stringOf(body, 'apiKey', 'an API key');
	const model = stringOf(body, 'model', 'a model');
	const adapter = PROVIDER_ADAPTERS[provider];
	try {
		await adapter.listModels(apiKey);
		await probe(adapter, apiKey, model);
	} catch (e) {
		return failure(e);
	}
	await saveKey(user.id, provider, apiKey, model);
	return keys(user.id);
};

/** Switches the active provider, and optionally its model (probed first). */
export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	requireChat();
	const body = await readBody(event.request);
	const provider = providerOf(body);
	const saved = await getKey(user.id, provider);
	if (!saved) error(404, 'No key saved for that provider.');
	if (body.model !== undefined) {
		const model = stringOf(body, 'model', 'a model');
		if (model !== saved.model || !saved.verified) {
			try {
				await probe(PROVIDER_ADAPTERS[provider], saved.apiKey, model);
			} catch (e) {
				return failure(e);
			}
			await setModel(user.id, provider, model);
		}
	}
	await setActive(user.id, provider);
	return keys(user.id);
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	requireChat();
	const provider = providerOf(await readBody(event.request));
	if (!(await deleteKey(user.id, provider))) error(404, 'No key saved for that provider.');
	return keys(user.id);
};
