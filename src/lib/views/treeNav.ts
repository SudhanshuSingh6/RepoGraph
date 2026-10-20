import type { FileNode, TreeNode } from '#analysis/graph/index.ts';
import { matchesSearch } from '#lib/workspace/filters.ts';

/** The nodes from the root down to the folder or file at `path` (just the root for ''),
 * or null when no node has that path — e.g. a filter has since hidden it, or merged it
 * into a collapsed chain under a longer path. */
export function ancestry(root: TreeNode, path: string): TreeNode[] | null {
	const chain = [root];
	let node = root;
	while (node.path !== path) {
		const next = node.children?.find(
			(c) => c.path === path || (c.children !== undefined && path.startsWith(c.path + '/'))
		);
		if (!next) return null;
		chain.push(next);
		node = next;
	}
	return chain;
}

export function findNode(root: TreeNode, path: string): TreeNode | null {
	return ancestry(root, path)?.at(-1) ?? null;
}

/** Every folder's path, for "Expand all". */
export function folderPaths(root: TreeNode): string[] {
	const out: string[] = [];
	const walk = (n: TreeNode) => {
		if (!n.children) return;
		out.push(n.path);
		n.children.forEach(walk);
	};
	walk(root);
	return out;
}

/**
 * Search hits as node paths: every file whose path matches, plus each folder holding
 * one, so the way down to a match stays visible. Null when the search box is empty.
 */
export function searchHits(root: TreeNode, files: FileNode[], query: string): Set<string> | null {
	if (!query.trim()) return null;
	const hits = new Set<string>();
	const walk = (n: TreeNode): boolean => {
		const hit =
			n.file !== undefined
				? matchesSearch(files[n.file].path, query)
				: n.children!.map(walk).some(Boolean);
		if (hit) hits.add(n.path);
		return hit;
	};
	walk(root);
	return hits;
}
