import type { ProviderId } from '#lib/chat/shared.ts';
import { db } from './client';

// Only src/lib/server/chat/keys.ts should call these: it owns the encryption.

export type ChatKeyRow = {
	provider: ProviderId;
	ciphertext: Buffer;
	iv: Buffer;
	tag: Buffer;
	hint: string;
	model: string;
	verified: boolean;
	active: boolean;
};

export type EncryptedKey = { ciphertext: Buffer; iv: Buffer; tag: Buffer; hint: string };

const toRow = (r: Record<string, unknown>): ChatKeyRow => ({
	provider: r.provider as ProviderId,
	ciphertext: r.ciphertext as Buffer,
	iv: r.iv as Buffer,
	tag: r.tag as Buffer,
	hint: r.hint as string,
	model: r.model as string,
	verified: r.model_verified_at !== null,
	active: r.active as boolean
});

export async function selectChatKeys(userId: string): Promise<ChatKeyRow[]> {
	const rows = await db()`
		select * from chat_keys where user_id = ${userId} order by provider
	`;
	return rows.map(toRow);
}

export async function selectChatKey(
	userId: string,
	provider: ProviderId
): Promise<ChatKeyRow | null> {
	const [row] = await db()`
		select * from chat_keys where user_id = ${userId} and provider = ${provider}
	`;
	return row ? toRow(row) : null;
}

export async function selectActiveChatKey(userId: string): Promise<ChatKeyRow | null> {
	const [row] = await db()`select * from chat_keys where user_id = ${userId} and active`;
	return row ? toRow(row) : null;
}

/** Saves (or replaces) a provider's key with an already-verified model, and makes it
 * the active one. */
export async function upsertChatKey(
	userId: string,
	provider: ProviderId,
	key: EncryptedKey,
	model: string
): Promise<void> {
	await db().begin(async (tx) => {
		await tx`update chat_keys set active = false where user_id = ${userId} and active`;
		await tx`
			insert into chat_keys
				(user_id, provider, ciphertext, iv, tag, hint, model, model_verified_at, active)
			values (${userId}, ${provider}, ${key.ciphertext}, ${key.iv}, ${key.tag}, ${key.hint},
				${model}, now(), true)
			on conflict (user_id, provider) do update set
				ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
				hint = excluded.hint, model = excluded.model,
				model_verified_at = excluded.model_verified_at, active = true, updated_at = now()
		`;
	});
}

/** Makes a saved provider the active one; false if the user has no key for it. */
export async function activateChatKey(userId: string, provider: ProviderId): Promise<boolean> {
	return db().begin(async (tx) => {
		const [hit] = await tx`
			select 1 from chat_keys where user_id = ${userId} and provider = ${provider}
		`;
		if (!hit) return false;
		// Two statements: the one-active unique index is checked row by row.
		await tx`update chat_keys set active = false where user_id = ${userId} and active`;
		await tx`
			update chat_keys set active = true where user_id = ${userId} and provider = ${provider}
		`;
		return true;
	}) as Promise<boolean>;
}

/** Records a probe result for `model`. A no-op if the model changed in the meantime. */
export async function setChatModelVerified(
	userId: string,
	provider: ProviderId,
	model: string,
	verified: boolean
): Promise<void> {
	await db()`
		update chat_keys set model_verified_at = case when ${verified} then now() end
		where user_id = ${userId} and provider = ${provider} and model = ${model}
	`;
}

/** Switches to an already-verified model. */
export async function updateChatModel(
	userId: string,
	provider: ProviderId,
	model: string
): Promise<void> {
	await db()`
		update chat_keys set model = ${model}, model_verified_at = now(), updated_at = now()
		where user_id = ${userId} and provider = ${provider}
	`;
}

/** Removes a key. If it was the active one, the most recently updated remaining key
 * takes over. */
export async function deleteChatKey(userId: string, provider: ProviderId): Promise<boolean> {
	return db().begin(async (tx) => {
		const [gone] = await tx`
			delete from chat_keys where user_id = ${userId} and provider = ${provider}
			returning active
		`;
		if (!gone) return false;
		if (gone.active) {
			await tx`
				update chat_keys set active = true
				where user_id = ${userId} and provider = (
					select provider from chat_keys where user_id = ${userId}
					order by updated_at desc limit 1
				)
			`;
		}
		return true;
	}) as Promise<boolean>;
}
