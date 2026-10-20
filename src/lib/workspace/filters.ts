import type { FileNode, Lang } from '#analysis/graph/index.ts';
import { LANGS } from './langs.ts';

/** Language chips (repograph-spec.md §15): a language is on unless switched off. */
export type LangOn = Partial<Record<Lang, boolean>>;

/** Which files the views draw: the prototype's `S.active`, from the language chips and
 * "Hide tests". */
export function activeMask(files: FileNode[], langOn: LangOn, hideTests: boolean): boolean[] {
	return files.map((f) => langOn[f.lang] !== false && !(hideTests && f.isTest));
}

/** The search box: a live, case-insensitive substring filter over file paths. */
export function matchesSearch(path: string, query: string): boolean {
	const q = query.trim().toLowerCase();
	return !q || path.toLowerCase().includes(q);
}

/** One chip per language present, with its file count (tests excluded while hidden). */
export function langCounts(files: FileNode[], hideTests: boolean): { lang: Lang; files: number }[] {
	const counts = new Map<Lang, number>();
	for (const f of files) {
		if (hideTests && f.isTest) continue;
		counts.set(f.lang, (counts.get(f.lang) ?? 0) + 1);
	}
	const present = new Set(files.map((f) => f.lang));
	return LANGS.filter((l) => present.has(l)).map((lang) => ({
		lang,
		files: counts.get(lang) ?? 0
	}));
}
