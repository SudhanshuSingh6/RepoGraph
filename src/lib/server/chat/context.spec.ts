import { describe, expect, it } from 'vitest';
import { buildChatContext, CONTEXT_ACK } from './context.ts';
import { chatRepo } from './fixture.ts';

describe('buildChatContext', () => {
	it('fills in the spec §17 prompt, with the tree-sitter caveat', () => {
		expect(buildChatContext(chatRepo()))
			.toBe(`You are a code-exploration assistant built into Repograph, a codebase-visualization
tool. Answer questions about the codebase the person has open right now, as a
knowledgeable colleague who has actually looked at the code, not a generic assistant.

Repository: demo

Totals: 5 files, 1,250 lines, 3 resolved imports between files, 1 import cycles.

Languages: Python: 1,205 lines across 2 files; TypeScript: 40 lines across 2 files; JavaScript: 5 lines across 1 files

Top-level structure (folder: files, lines):
api: 1 files, 1,200 lines
web: 3 files, 45 lines
  web/sub: 1 files, 5 lines

Largest files by line count:
api/c.py — 1,200 lines
web/b.ts — 30 lines
web/a.ts — 10 lines
main.py — 5 lines
web/sub/d.js — 5 lines

Most-imported files:
web/b.ts — imported by 2 files
web/a.ts — imported by 1 file

Import cycles found:
web/a.ts -> web/b.ts -> (back to start)

You have three tools. getFile(path): returns a file's full source plus what it
imports and what imports it — use it before describing what any specific file does.
searchFiles(query): finds file paths containing a substring, when you are not sure
of an exact path. listChildren(path): lists the immediate files and subfolders under
a folder path ("" for the repository root) — use it to explore structure beyond the
summary above. Call these whenever a question needs real code, not just the summary;
do not guess at file contents.

Imports above were found by parsing source files with tree-sitter, not by
compiling the project — dynamic, reflective, or unusually aliased imports may be
missing, so real coupling can be higher than shown.

Answer concisely in plain prose, and name exact file paths when relevant. No need
for a preamble like "Based on the codebase" — just answer.`);
	});

	it('truncates folders at 10 per level and says how many more', () => {
		const repo = chatRepo();
		const files = Array.from({ length: 12 }, (_, i) => ({
			path: `f${String(i).padStart(2, '0')}/x.py`,
			lang: 'py' as const,
			loc: 100 - i,
			isTest: false,
			isEntry: false
		}));
		const text = buildChatContext({
			...repo,
			graph: { files, edges: [] },
			derived: { ...repo.derived, fanIn: files.map(() => 0), cycles: [] }
		});
		expect(text).toContain('f09: 1 files, 91 lines\n... and 2 more folders');
		expect(text).toContain('Most-imported files:\nNone.');
		expect(text).toContain('Import cycles found:\nNone.');
	});

	it('acknowledges with the spec wording', () => {
		expect(CONTEXT_ACK).toBe('Got it — I can see the codebase. What would you like to know?');
	});
});
