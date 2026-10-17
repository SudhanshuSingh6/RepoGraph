import { defineEnvVars } from '@sveltejs/kit/env';

// Declared optional so the app boots without a database; the db client throws
// a clear error on first query if it's missing.
export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Postgres connection string, e.g. postgres://user:pass@localhost:5432/repograph',
		schema: (value) => value || undefined
	}
});
