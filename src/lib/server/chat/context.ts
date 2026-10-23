// The one-time context turn (repograph-spec.md §17), built from the unfiltered repo.
// It is sent as a synthetic user turn, answered by CONTEXT_ACK, before the real
// conversation. Its sections and wording follow the spec exactly, except the imports
// caveat: this app parses imports with tree-sitter, not regular expressions.
import type { Derived, Graph, Lang } from '#analysis/graph/index.ts';
import { LANG_NAMES } from '#lib/workspace/langs.ts';

export const CONTEXT_ACK = 'Got it — I can see the codebase. What would you like to know?';

const n = (x: number) => x.toLocaleString('en-US');

type Folder = { path: string; files: number; lines: number };

/** Folders `depth` segments deep (under `parent`), most lines first. */
function folders(graph: Graph, depth: number, parent = ''): Folder[] {
	const by = new Map<string, Folder>();
	for (const f of graph.files) {
		const parts = f.path.split('/');
		if (parts.length <= depth) continue; // a file at this depth, not a folder
		const path = parts.slice(0, depth).join('/');
		if (parent && !path.startsWith(`${parent}/`)) continue;
		const d = by.get(path) ?? { path, files: 0, lines: 0 };
		d.files++;
		d.lines += f.loc;
		by.set(path, d);
	}
	return [...by.values()].sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : 1));
}

const PER_LEVEL = 10;

function structure(graph: Graph): string {
	const top = folders(graph, 1);
	if (top.length === 0) return 'All files are at the repository root.';
	const line = (d: Folder, indent = '') =>
		`${indent}${d.path}: ${n(d.files)} files, ${n(d.lines)} lines`;
	const more = (k: number, indent = '') =>
		`${indent}... and ${k} more ${k === 1 ? 'folder' : 'folders'}`;
	const out: string[] = [];
	for (const d of top.slice(0, PER_LEVEL)) {
		out.push(line(d));
		const subs = folders(graph, 2, d.path);
		for (const s of subs.slice(0, PER_LEVEL)) out.push(line(s, '  '));
		if (subs.length > PER_LEVEL) out.push(more(subs.length - PER_LEVEL, '  '));
	}
	if (top.length > PER_LEVEL) out.push(more(top.length - PER_LEVEL));
	return out.join('\n');
}

function languages(graph: Graph): string {
	const by = new Map<Lang, { files: number; lines: number }>();
	for (const f of graph.files) {
		const s = by.get(f.lang) ?? { files: 0, lines: 0 };
		s.files++;
		s.lines += f.loc;
		by.set(f.lang, s);
	}
	return [...by]
		.sort((a, b) => b[1].lines - a[1].lines)
		.map(([lang, s]) => `${LANG_NAMES[lang]}: ${n(s.lines)} lines across ${n(s.files)} files`)
		.join('; ');
}

export function buildChatContext(repo: { name: string; graph: Graph; derived: Derived }): string {
	const { name, graph, derived } = repo;
	const files = graph.files;
	const indexes = files.map((_, i) => i);
	const lines = files.reduce((s, f) => s + f.loc, 0);

	const largest = [...indexes]
		.sort((a, b) => files[b].loc - files[a].loc)
		.slice(0, 10)
		.map((i) => `${files[i].path} — ${n(files[i].loc)} lines`);
	const imported = indexes
		.filter((i) => derived.fanIn[i] > 0)
		.sort((a, b) => derived.fanIn[b] - derived.fanIn[a])
		.slice(0, 10)
		.map(
			(i) =>
				`${files[i].path} — imported by ${derived.fanIn[i]} ${derived.fanIn[i] === 1 ? 'file' : 'files'}`
		);
	const cycles = derived.cycles
		.slice(0, 8)
		.map((c) => `${c.map((i) => files[i].path).join(' -> ')} -> (back to start)`);

	return [
		`You are a code-exploration assistant built into Repograph, a codebase-visualization
tool. Answer questions about the codebase the person has open right now, as a
knowledgeable colleague who has actually looked at the code, not a generic assistant.`,
		`Repository: ${name}`,
		`Totals: ${n(files.length)} files, ${n(lines)} lines, ${n(graph.edges.length)} resolved imports between files, ${n(derived.cycles.length)} import cycles.`,
		`Languages: ${languages(graph) || 'none'}`,
		`Top-level structure (folder: files, lines):\n${structure(graph)}`,
		`Largest files by line count:\n${largest.join('\n') || 'None.'}`,
		`Most-imported files:\n${imported.join('\n') || 'None.'}`,
		`Import cycles found:\n${cycles.join('\n') || 'None.'}`,
		`You have three tools. getFile(path): returns a file's full source plus what it
imports and what imports it — use it before describing what any specific file does.
searchFiles(query): finds file paths containing a substring, when you are not sure
of an exact path. listChildren(path): lists the immediate files and subfolders under
a folder path ("" for the repository root) — use it to explore structure beyond the
summary above. Call these whenever a question needs real code, not just the summary;
do not guess at file contents.`,
		`Imports above were found by parsing source files with tree-sitter, not by
compiling the project — dynamic, reflective, or unusually aliased imports may be
missing, so real coupling can be higher than shown.`,
		`Answer concisely in plain prose, and name exact file paths when relevant. No need
for a preamble like "Based on the codebase" — just answer.`
	].join('\n\n');
}
