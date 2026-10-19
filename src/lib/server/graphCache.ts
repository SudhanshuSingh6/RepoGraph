// Derived graphs are cached per project, keyed by the import's version stamp
// (projects.parsed_at): a re-import changes the stamp, so a stale entry is simply never
// served — no invalidation call needed. In-memory and per app instance; moving it to
// Redis or Postgres later only changes this module.

const MAX_PROJECTS = 20;

type Entry = { version: string; value: Promise<unknown> };
const entries = new Map<string, Entry>(); // insertion order = least recently used first

export function cached<T>(
	projectId: string,
	version: string,
	compute: () => Promise<T>
): Promise<T> {
	const hit = entries.get(projectId);
	entries.delete(projectId);
	if (hit && hit.version === version) {
		entries.set(projectId, hit);
		return hit.value as Promise<T>;
	}
	// The promise itself is cached, so concurrent first requests compute once.
	const value = compute();
	const entry = { version, value };
	entries.set(projectId, entry);
	value.catch(() => {
		if (entries.get(projectId) === entry) entries.delete(projectId);
	});
	while (entries.size > MAX_PROJECTS) entries.delete(entries.keys().next().value!);
	return value;
}

export function clearGraphCache() {
	entries.clear();
}
