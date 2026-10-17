// Applies every not-yet-applied db/migrations/*.sql file in filename order, each in
// its own transaction, recording it in schema_migrations. Run via `npm run db:migrate`.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set — copy .env.example to .env and fill it in.');
	process.exit(1);
}

const dir = path.join(import.meta.dirname, 'migrations');
const sql = postgres(url, { onnotice: () => {} });

try {
	await sql`
		create table if not exists schema_migrations (
			name text primary key,
			applied_at timestamptz not null default now()
		)
	`;
	const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
	const pending = (await readdir(dir)).filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();

	if (pending.length === 0) console.log('No pending migrations.');
	for (const name of pending) {
		const body = await readFile(path.join(dir, name), 'utf8');
		await sql.begin(async (tx) => {
			await tx.unsafe(body);
			await tx`insert into schema_migrations (name) values (${name})`;
		});
		console.log(`Applied ${name}`);
	}
} finally {
	await sql.end();
}
