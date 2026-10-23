import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ CHAT_KEY_SECRET: randomBytes(32).toString('base64') }));
vi.mock('#lib/server/db/chatKeys.ts', () => ({}));

const { decryptKey, encryptKey, keyHint } = await import('./keys.ts');

const SECRET = randomBytes(32);
const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';

describe('chat key encryption', () => {
	it('round-trips, and the ciphertext does not contain the key', () => {
		const enc = encryptKey(KEY, SECRET);
		expect(decryptKey(enc, SECRET)).toBe(KEY);
		expect(enc.ciphertext.toString('utf8')).not.toContain('abcdef');
	});

	it('uses a fresh IV every time', () => {
		const a = encryptKey(KEY, SECRET);
		const b = encryptKey(KEY, SECRET);
		expect(a.iv.equals(b.iv)).toBe(false);
		expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
	});

	it('rejects a tampered ciphertext, a wrong tag or another secret', () => {
		const enc = encryptKey(KEY, SECRET);
		const flipped = Buffer.from(enc.ciphertext);
		flipped[0] ^= 1;
		expect(() => decryptKey({ ...enc, ciphertext: flipped }, SECRET)).toThrow();
		expect(() => decryptKey({ ...enc, tag: randomBytes(16) }, SECRET)).toThrow();
		expect(() => decryptKey(enc, randomBytes(32))).toThrow();
	});

	it('keeps only the last four characters readable', () => {
		expect(keyHint(KEY)).toBe('…6789');
		expect(encryptKey(KEY, SECRET).hint).toBe('…6789');
		expect(keyHint(KEY).replace('…', '')).toHaveLength(4);
	});
});
