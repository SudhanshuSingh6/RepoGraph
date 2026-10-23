// A small repo for the chat specs: web/a.ts ⇄ web/b.ts is a cycle, api/c.py stands
// alone, README-level main.py sits at the root.
import { derive, type FileNode, type Lang } from '#analysis/graph/index.ts';
import type { ChatRepo } from './repo.ts';

const LANG: Record<string, Lang> = { java: 'java', py: 'py', ts: 'ts', js: 'js' };

export function chatRepo(): ChatRepo {
	const specs: [string, number][] = [
		['api/c.py', 1200],
		['main.py', 5],
		['web/a.ts', 10],
		['web/b.ts', 30],
		['web/sub/d.js', 5]
	];
	const files: FileNode[] = specs.map(([path, loc]) => ({
		path,
		lang: LANG[path.split('.').pop()!],
		loc,
		isTest: false,
		isEntry: false
	}));
	const at = (p: string) => files.findIndex((f) => f.path === p);
	const graph = {
		files,
		edges: [
			[at('web/a.ts'), at('web/b.ts')],
			[at('web/b.ts'), at('web/a.ts')],
			[at('web/sub/d.js'), at('web/b.ts')]
		] as [number, number][]
	};
	return {
		projectId: 'p1',
		name: 'demo',
		graph,
		derived: derive(graph),
		byPath: new Map(files.map((f, i) => [f.path, i]))
	};
}
