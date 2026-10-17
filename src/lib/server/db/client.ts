// The single Postgres connection for the app.
//
// Convention: every database access goes through a named repository function in
// src/lib/server/db/*.ts (e.g. getProject(), getParsedFiles()) — never a raw query
// inside a route. That keeps a cache layer or read replica addable later inside the
// function body with zero call-site changes. ESLint enforces that only files in this
// folder may import this module.
import postgres from 'postgres';
import { DATABASE_URL } from '$app/env/private';

let client: postgres.Sql | undefined;

export function db(): postgres.Sql {
	if (!client) {
		if (!DATABASE_URL) throw new Error('DATABASE_URL is not set — see .env.example');
		client = postgres(DATABASE_URL);
	}
	return client;
}
