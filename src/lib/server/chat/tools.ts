// The chat's tools (repograph-spec.md §17), as one array every adapter reads from: a
// new tool (e.g. semanticSearch, later) is an entry here, not a change to the route.
import { readProjectFile } from '#lib/server/fileStorage.ts';
import { LANG_NAMES } from '#lib/workspace/langs.ts';
import type { ChatRepo } from './repo.ts';
import type { ToolSpec } from './types.ts';

export type Tool = ToolSpec & {
	run(input: Record<string, unknown>, repo: ChatRepo): Promise<unknown>;
};

export const MAX_SOURCE_CHARS = 22_000;
const MAX_SUGGESTIONS = 10;
const MAX_MATCHES = 50;

/** Paths come back from models as `./a/b`, `/a/b/` or `a\\b`; the repo uses `a/b`. */
export const normalizePath = (raw: unknown) =>
	String(raw ?? '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/^(\.\/)+/, '')
		.replace(/^\/+|\/+$/g, '');

const language = (repo: ChatRepo, i: number) => LANG_NAMES[repo.graph.files[i].lang];

export const getFile: Tool = {
	name: 'getFile',
	description:
		"Returns a file's language, line count, the files it imports and the files that import it, and up to 22,000 characters of its source (truncated is true if cut). If the path isn't found, returns suggestions instead.",
	input_schema: {
		type: 'object',
		properties: { path: { type: 'string', description: 'File path from the repository root' } },
		required: ['path']
	},
	async run(input, repo) {
		const path = normalizePath(input.path);
		const i = repo.byPath.get(path);
		if (i === undefined) {
			const base = (path.split('/').pop() ?? '').toLowerCase();
			const suggestions = base
				? repo.graph.files
						.filter((f) => f.path.toLowerCase().includes(base))
						.slice(0, MAX_SUGGESTIONS)
						.map((f) => f.path)
				: [];
			return { error: `No file at "${path}".`, suggestions };
		}
		const f = repo.graph.files[i];
		const paths = (xs: number[]) => xs.map((j) => repo.graph.files[j].path).sort();
		const source = (await readProjectFile(repo.projectId, f.path)) ?? '';
		return {
			path: f.path,
			language: language(repo, i),
			lines: f.loc,
			imports: paths(repo.derived.adj[i]),
			importedBy: paths(repo.derived.rev[i]),
			source: source.slice(0, MAX_SOURCE_CHARS),
			truncated: source.length > MAX_SOURCE_CHARS
		};
	}
};

export const searchFiles: Tool = {
	name: 'searchFiles',
	description:
		'Case-insensitive substring search over every file path. Returns the match count and up to 50 matches with language and line count.',
	input_schema: {
		type: 'object',
		properties: { query: { type: 'string', description: 'Substring to look for in paths' } },
		required: ['query']
	},
	async run(input, repo) {
		const query = String(input.query ?? '').trim();
		if (!query) return { error: 'Give a non-empty query.' };
		const q = query.toLowerCase();
		const hits = repo.graph.files.flatMap((f, i) => (f.path.toLowerCase().includes(q) ? [i] : []));
		return {
			query,
			count: hits.length,
			matches: hits.slice(0, MAX_MATCHES).map((i) => ({
				path: repo.graph.files[i].path,
				language: language(repo, i),
				lines: repo.graph.files[i].loc
			}))
		};
	}
};

export const listChildren: Tool = {
	name: 'listChildren',
	description:
		'Lists the immediate files and subfolders of a folder ("" for the repository root). Folders report their total file count and lines.',
	input_schema: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Folder path from the repository root; "" for the root' }
		},
		required: ['path']
	},
	async run(input, repo) {
		const path = normalizePath(input.path);
		const prefix = path ? `${path}/` : '';
		const folders = new Map<string, { name: string; path: string; files: number; lines: number }>();
		const files: { name: string; path: string; language: string; lines: number }[] = [];
		repo.graph.files.forEach((f, i) => {
			if (!f.path.startsWith(prefix)) return;
			const rest = f.path.slice(prefix.length);
			const slash = rest.indexOf('/');
			if (slash === -1) {
				files.push({ name: rest, path: f.path, language: language(repo, i), lines: f.loc });
				return;
			}
			const name = rest.slice(0, slash);
			const d = folders.get(name) ?? { name, path: prefix + name, files: 0, lines: 0 };
			d.files++;
			d.lines += f.loc;
			folders.set(name, d);
		});
		if (path && folders.size === 0 && files.length === 0) {
			return { error: `No folder at "${path}".` };
		}
		return {
			path,
			folders: [...folders.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
			files: files.sort((a, b) => (a.name < b.name ? -1 : 1))
		};
	}
};

export const TOOLS: Tool[] = [getFile, searchFiles, listChildren];

/** Runs a model's tool call; unknown tools and failures come back as a result the
 * model can read, not an exception that ends the conversation. */
export async function runTool(
	name: string,
	input: Record<string, unknown>,
	repo: ChatRepo
): Promise<unknown> {
	const tool = TOOLS.find((t) => t.name === name);
	if (!tool) return { error: `Unknown tool "${name}".` };
	return tool.run(input, repo);
}
