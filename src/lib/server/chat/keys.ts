// Users' own chat API keys: encrypted at rest with AES-256-GCM under CHAT_KEY_SECRET,
// decrypted only here, server-side, for the request that uses them. A key is never
// returned to the browser, logged or put in an error message; the browser sees a hint.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CHAT_KEY_SECRET } from '$app/env/private';
import type { ProviderId, SavedKey } from '#lib/chat/shared.ts';
import {
	activateChatKey,
	deleteChatKey,
	selectActiveChatKey,
	selectChatKey,
	selectChatKeys,
	setChatModelVerified,
	updateChatModel,
	upsertChatKey,
	type ChatKeyRow,
	type EncryptedKey
} from '#lib/server/db/chatKeys.ts';

export const chatAvailable = () => Boolean(CHAT_KEY_SECRET);

function secret(): Buffer {
	if (!CHAT_KEY_SECRET) throw new Error('CHAT_KEY_SECRET is not set — see .env.example');
	return Buffer.from(CHAT_KEY_SECRET, 'base64');
}

/** The last four characters, which is all of a key the browser ever sees again. */
export const keyHint = (apiKey: string) => `…${apiKey.slice(-4)}`;

export function encryptKey(apiKey: string, key: Buffer): EncryptedKey {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
	return { ciphertext, iv, tag: cipher.getAuthTag(), hint: keyHint(apiKey) };
}

/** Throws if the ciphertext, IV or tag were tampered with, or the secret changed. */
export function decryptKey(enc: Pick<EncryptedKey, 'ciphertext' | 'iv' | 'tag'>, key: Buffer) {
	const decipher = createDecipheriv('aes-256-gcm', key, enc.iv);
	decipher.setAuthTag(enc.tag);
	return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]).toString('utf8');
}

const toSaved = (r: ChatKeyRow): SavedKey => ({
	provider: r.provider,
	hint: r.hint,
	model: r.model,
	verified: r.verified,
	active: r.active
});

export async function listKeys(userId: string): Promise<SavedKey[]> {
	return (await selectChatKeys(userId)).map(toSaved);
}

export function saveKey(userId: string, provider: ProviderId, apiKey: string, model: string) {
	return upsertChatKey(userId, provider, encryptKey(apiKey, secret()), model);
}

export type UsableKey = SavedKey & { apiKey: string };

const usable = (r: ChatKeyRow | null): UsableKey | null =>
	r && { ...toSaved(r), apiKey: decryptKey(r, secret()) };

export async function getActiveKey(userId: string): Promise<UsableKey | null> {
	return usable(await selectActiveChatKey(userId));
}

export async function getKey(userId: string, provider: ProviderId): Promise<UsableKey | null> {
	return usable(await selectChatKey(userId, provider));
}

export {
	activateChatKey as setActive,
	deleteChatKey as deleteKey,
	setChatModelVerified as setModelVerified,
	updateChatModel as setModel
};
