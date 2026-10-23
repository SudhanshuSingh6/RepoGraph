import { beforeEach, describe, expect, it, vi } from 'vitest';

const readProjectFile = vi.fn();
vi.mock('#lib/server/fileStorage.ts', () => ({ readProjectFile }));

const { MAX_SOURCE_CHARS, TOOLS, runTool } = await import('./tools.ts');
const { chatRepo } = await import('./fixture.ts');

const repo = chatRepo();

beforeEach(() => {
	readProjectFile.mockReset();
	readProjectFile.mockResolvedValue('export const b = 1;\n');
});

describe('TOOLS', () => {
	it('is the three spec tools, each with an object schema', () => {
		expect(TOOLS.map((t) => t.name)).toEqual(['getFile', 'searchFiles', 'listChildren']);
		for (const t of TOOLS) expect(t.input_schema.type).toBe('object');
	});
});

describe('getFile', () => {
	it('returns source with its imports and importers', async () => {
		expect(await runTool('getFile', { path: './web/b.ts' }, repo)).toEqual({
			path: 'web/b.ts',
			language: 'TypeScript',
			lines: 30,
			imports: ['web/a.ts'],
			importedBy: ['web/a.ts', 'web/sub/d.js'],
			source: 'export const b = 1;\n',
			truncated: false
		});
		expect(readProjectFile).toHaveBeenCalledWith('p1', 'web/b.ts');
	});

	it('caps the source at 22,000 characters and flags it', async () => {
		readProjectFile.mockResolvedValue('x'.repeat(MAX_SOURCE_CHARS + 5));
		const out = (await runTool('getFile', { path: 'api/c.py' }, repo)) as {
			source: string;
			truncated: boolean;
		};
		expect(out.source).toHaveLength(22_000);
		expect(out.truncated).toBe(true);
	});

	it('suggests paths containing the basename on a miss', async () => {
		expect(await runTool('getFile', { path: 'src/B.TS' }, repo)).toEqual({
			error: 'No file at "src/B.TS".',
			suggestions: ['web/b.ts']
		});
		expect(readProjectFile).not.toHaveBeenCalled();
	});
});

describe('searchFiles', () => {
	it('matches paths case-insensitively', async () => {
		expect(await runTool('searchFiles', { query: 'WEB/' }, repo)).toMatchObject({
			count: 3,
			matches: [
				{ path: 'web/a.ts', language: 'TypeScript', lines: 10 },
				{ path: 'web/b.ts', language: 'TypeScript', lines: 30 },
				{ path: 'web/sub/d.js', language: 'JavaScript', lines: 5 }
			]
		});
	});

	it('returns at most 50 matches but the full count', async () => {
		const files = Array.from({ length: 60 }, (_, i) => ({
			path: `m${i}.py`,
			lang: 'py' as const,
			loc: 1,
			isTest: false,
			isEntry: false
		}));
		const big = { ...repo, graph: { files, edges: [] } };
		const out = (await runTool('searchFiles', { query: '.py' }, big)) as {
			count: number;
			matches: unknown[];
		};
		expect(out.count).toBe(60);
		expect(out.matches).toHaveLength(50);
	});
});

describe('listChildren', () => {
	it('lists the root: folders with totals, then files', async () => {
		expect(await runTool('listChildren', { path: '' }, repo)).toEqual({
			path: '',
			folders: [
				{ name: 'api', path: 'api', files: 1, lines: 1200 },
				{ name: 'web', path: 'web', files: 3, lines: 45 }
			],
			files: [{ name: 'main.py', path: 'main.py', language: 'Python', lines: 5 }]
		});
	});

	it('lists a subfolder, and reports a missing one', async () => {
		expect(await runTool('listChildren', { path: 'web/' }, repo)).toMatchObject({
			path: 'web',
			folders: [{ name: 'sub', path: 'web/sub', files: 1, lines: 5 }],
			files: [{ name: 'a.ts' }, { name: 'b.ts' }]
		});
		expect(await runTool('listChildren', { path: 'we' }, repo)).toEqual({
			error: 'No folder at "we".'
		});
	});
});

it('answers an unknown tool with an error the model can read', async () => {
	expect(await runTool('rm', {}, repo)).toEqual({ error: 'Unknown tool "rm".' });
});
