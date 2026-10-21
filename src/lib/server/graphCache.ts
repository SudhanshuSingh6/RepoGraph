// Derived payloads (graph, types, …) are cached per `<projectId>:<kind>` key, stamped
// with the import's version (projects.parsed_at): a re-import changes the stamp, so a stale entry is simply never
// served — no invalidation call needed. In-memory and per app instance; moving it to
// Redis or Postgres later only changes this module.

const MAX_ENTRIES = 40; // ~20 projects × their payload kinds

type Entry = { version: string; value: Promise<unknown> };
const entries = new Map<string, Entry>(); // insertion order = least recently used first

export function cached<T>(key: string, version: string, compute: () => Promise<T>): Promise<T> {
	const hit = entries.get(key);
	entries.delete(key);
	if (hit && hit.version === version) {
		entries.set(key, hit);
		return hit.value as Promise<T>;
	}
	// The promise itself is cached, so concurrent first requests compute once.
	const value = compute();
	const entry = { version, value };
	entries.set(key, entry);
	value.catch(() => {
		if (entries.get(key) === entry) entries.delete(key);
	});
	while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
	return value;
}

export function clearGraphCache() {
	entries.clear();
}
