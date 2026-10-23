import { defineEnvVars } from '@sveltejs/kit/env';

// All optional so the app boots without them; the code that needs each one throws
// a clear error on first use if it's missing.
const optional = (value: string | undefined) => value || undefined;

const positiveInt = (name: string, fallback: number) => (value: string | undefined) => {
	if (!value) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
	return n;
};

// Chat API keys are encrypted with this (AES-256-GCM), so it must decode to 32 bytes.
const keySecret = (value: string | undefined) => {
	if (!value) return undefined;
	if (Buffer.from(value, 'base64').length !== 32) {
		throw new Error('CHAT_KEY_SECRET must be 32 random bytes, base64 (openssl rand -base64 32)');
	}
	return value;
};

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Postgres connection string, e.g. postgres://user:pass@localhost:5432/repograph',
		schema: optional
	},
	GITHUB_CLIENT_ID: {
		description: 'GitHub OAuth App client ID',
		schema: optional
	},
	GITHUB_CLIENT_SECRET: {
		description: 'GitHub OAuth App client secret',
		schema: optional
	},
	GITHUB_CALLBACK_URL: {
		description: 'OAuth callback, e.g. http://localhost:5173/auth/github/callback',
		schema: optional
	},
	CHAT_KEY_SECRET: {
		description:
			"Encrypts users' chat API keys at rest: 32 random bytes, base64. Chat is unavailable without it.",
		schema: keySecret
	},
	IMPORT_MAX_BYTES: {
		description: 'Import size cap in bytes (upload size, and decompressed/cloned size)',
		schema: positiveInt('IMPORT_MAX_BYTES', 200 * 1024 * 1024)
	},
	IMPORT_MAX_FILES: {
		description: 'Import file-count cap',
		schema: positiveInt('IMPORT_MAX_FILES', 20_000)
	}
});
