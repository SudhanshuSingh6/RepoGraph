import type { Lang } from '#analysis/graph/index.ts';

export const LANGS: readonly Lang[] = ['java', 'js', 'ts', 'py'];

export const LANG_NAMES: Record<Lang, string> = {
	java: 'Java',
	js: 'JavaScript',
	ts: 'TypeScript',
	py: 'Python'
};

/** repograph-spec.md §2 — the same values as the `--lang-*` tokens in app.css, for code
 * that needs a concrete color (contrast checks) rather than a CSS variable. */
export const LANG_COLORS: Record<Lang, string> = {
	java: '#e08a2c',
	js: '#e5c92f',
	ts: '#3c82d6',
	py: '#38a67a'
};
