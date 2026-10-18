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
	IMPORT_MAX_BYTES: {
		description: 'Import size cap in bytes (upload size, and decompressed/cloned size)',
		schema: positiveInt('IMPORT_MAX_BYTES', 200 * 1024 * 1024)
	},
	IMPORT_MAX_FILES: {
		description: 'Import file-count cap',
		schema: positiveInt('IMPORT_MAX_FILES', 20_000)
	}
});
