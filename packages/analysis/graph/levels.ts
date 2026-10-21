import type { FileNode } from './types.ts';

/** Ungrouped: one node per file. */
export const UNGROUPED = Infinity;

const GROUPING_MIN_FILES = 60;
const MAX_GROUPS = 120;

function dirDepth(path: string): number {
	return path.split('/').length - 1;
}

/**
 * Grouping levels for the Dependencies/Architecture views (repograph-spec.md §7):
 * `[1, 2, …, maxDirDepth, Infinity]`.
 */
export function groupLevels(files: FileNode[]): number[] {
	const max = files.reduce((m, f) => Math.max(m, dirDepth(f.path)), 0);
	return [...Array.from({ length: max }, (_, i) => i + 1), UNGROUPED];
}

/** The group a file falls into at `level`: its first `level` folders. A file shallower
 * than that groups by its own folder; a root-level file is its own group. */
export function groupOf(path: string, level: number): string {
	if (level === UNGROUPED) return path;
	const dirs = path.split('/').slice(0, -1);
	return dirs.length ? dirs.slice(0, level).join('/') : path;
}

export function groupCount(files: FileNode[], level: number): number {
	return new Set(files.map((f) => groupOf(f.path, level))).size;
}

/**
 * Small repos (≤60 files) start ungrouped. Larger ones start grouped, at the most
 * detailed folder level that still keeps the view to ≤120 groups (level 1 if even
 * that has more).
 */
export function defaultGroupLevel(files: FileNode[]): number {
	if (files.length <= GROUPING_MIN_FILES) return UNGROUPED;
	return detailedLevelWithin(files, MAX_GROUPS);
}

/**
 * The most detailed folder level that keeps at most `maxGroups` groups (level 1 if even
 * that has more; ungrouped if there are no folders at all). The Architecture view's
 * component diagram starts here with `maxGroups` = 20 (repograph-spec.md §11).
 */
export function detailedLevelWithin(files: FileNode[], maxGroups: number): number {
	const levels = groupLevels(files).filter((l) => l !== UNGROUPED);
	for (let i = levels.length - 1; i >= 0; i--) {
		if (groupCount(files, levels[i]) <= maxGroups) return levels[i];
	}
	return levels[0] ?? UNGROUPED;
}
