// Client-side copy of the §5.1 rules (authoritative copy: workers/filters.py). The
// browser uses it only to avoid uploading node_modules & co.; the worker re-filters.
// Both are tested against tests/fixtures/filter-cases.json so they can't drift apart.

const EXT_LANG: Record<string, string> = {
	java: 'java',
	js: 'js',
	jsx: 'js',
	mjs: 'js',
	cjs: 'js',
	ts: 'ts',
	tsx: 'ts',
	mts: 'ts',
	cts: 'ts',
	py: 'py'
};

const IGNORED_DIRS = new Set([
	'node_modules',
	'.git',
	'.hg',
	'.svn',
	'dist',
	'build',
	'out',
	'target',
	'__pycache__',
	'.venv',
	'venv',
	'.tox',
	'.mypy_cache',
	'.pytest_cache',
	'.ruff_cache',
	'.idea',
	'.vscode',
	'coverage',
	'.next',
	'.nuxt',
	'.gradle',
	'.mvn',
	'bower_components',
	'site-packages',
	'.cache',
	'.turbo',
	'.angular',
	'.svelte-kit'
]);

const EXCLUDED_FILE = /\.d\.(ts|mts|cts)$|\.min\.(js|mjs|cjs)$|\.bundle\.js$/i;

export function langOf(path: string): string | null {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	if (dot < 0) return null;
	return EXT_LANG[name.slice(dot + 1).toLowerCase()] ?? null;
}

export function keepPath(path: string): boolean {
	const parts = path.split('/').filter(Boolean);
	if (parts.length === 0) return false;
	if (parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p))) return false;
	if (EXCLUDED_FILE.test(parts[parts.length - 1])) return false;
	return langOf(path) !== null;
}
