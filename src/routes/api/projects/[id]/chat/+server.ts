import { error, json } from '@sveltejs/kit';
import {
	MAX_TURN_CHARS,
	MAX_TURNS,
	PROVIDER_NAMES,
	type ChatReply,
	type ChatTurn
} from '#lib/chat/shared.ts';
import { requireProjectAccess, requireUser } from '#lib/server/auth/guards.ts';
import { runChat } from '#lib/server/chat/converse.ts';
import { ProviderError, UnsupportedModel } from '#lib/server/chat/errors.ts';
import { chatAvailable, getActiveKey, setModelVerified } from '#lib/server/chat/keys.ts';
import { probe } from '#lib/server/chat/probe.ts';
import { PROVIDER_ADAPTERS } from '#lib/server/chat/providers/index.ts';
import { getChatRepo } from '#lib/server/chat/repo.ts';
import type { RequestHandler } from './$types';

/** The visible conversation: alternating user/assistant turns ending with the user's. */
function parseHistory(body: unknown): ChatTurn[] {
	const turns = (body as { messages?: unknown } | null)?.messages;
	if (!Array.isArray(turns) || turns.length === 0 || turns.length > MAX_TURNS) {
		error(400, `Send between 1 and ${MAX_TURNS} messages.`);
	}
	return turns.map((t, i): ChatTurn => {
		const role = i % 2 === 0 ? 'user' : 'assistant';
		if (
			!t ||
			typeof t !== 'object' ||
			t.role !== role ||
			typeof t.content !== 'string' ||
			!t.content.trim() ||
			t.content.length > MAX_TURN_CHARS ||
			(i === turns.length - 1 && role !== 'user')
		) {
			error(400, 'Messages must alternate user/assistant, end with the user, and be non-empty.');
		}
		return { role, content: t.content };
	});
}

const unsupportedJson = (e: UnsupportedModel) =>
	json({ error: 'unsupported_model', reason: e.reason, message: e.message }, { status: 422 });

/** Chat with the open project, on the signed-in user's own API key. */
export const POST: RequestHandler = async (event) => {
	const project = await requireProjectAccess(event, event.params.id);
	const user = requireUser(event); // public projects too: chat runs on the user's key
	if (project.status !== 'ready' || !project.parsedAt) {
		error(409, 'This project has not finished importing yet.');
	}
	if (!chatAvailable()) error(503, 'Chat is currently unavailable.');
	const history = parseHistory(await event.request.json().catch(() => null));
	const key = await getActiveKey(user.id);
	if (!key) error(412, 'Add an API key to start chatting.');

	const provider = PROVIDER_ADAPTERS[key.provider];
	try {
		if (!key.verified) {
			await probe(provider, key.apiKey, key.model);
			await setModelVerified(user.id, key.provider, key.model, true);
		}
		const repo = await getChatRepo({ ...project, parsedAt: project.parsedAt });
		const result = await runChat({
			provider,
			apiKey: key.apiKey,
			model: key.model,
			repo,
			history,
			signal: event.request.signal
		});
		return json({ ...result, provider: key.provider, model: key.model } satisfies ChatReply);
	} catch (e) {
		if (e instanceof UnsupportedModel) {
			// e.g. the provider retired the model: it has to be checked again before use.
			await setModelVerified(user.id, key.provider, key.model, false);
			return unsupportedJson(e);
		}
		if (e instanceof ProviderError) {
			return json({ error: e.kind, message: e.message }, { status: 502 });
		}
		console.error(`chat (${PROVIDER_NAMES[key.provider]}) failed:`, (e as Error)?.name);
		throw e;
	}
};
