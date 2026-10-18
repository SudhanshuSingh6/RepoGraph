import { defineEnvVars } from '@sveltejs/kit/env';

// All optional so the app boots without them; the code that needs each one throws
// a clear error on first use if it's missing.
const optional = (value: string | undefined) => value || undefined;

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
	}
});
