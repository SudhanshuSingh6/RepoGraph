// repograph-spec.md §5.3 — accepts owner/repo, github.com/owner/repo, a full https URL,
// a git@github.com:owner/repo.git SSH URL, or a /tree/<branch>/… or /blob/<branch>/… URL.
const GITHUB_URL = /^github\.com\/([\w.-]+)\/([\w.-]+?)(?:\/(?:tree|blob)\/([^/]+)(?:\/.*)?)?\/?$/;

// Same rules the worker re-checks (workers/source.py) before running git.
const NAME = /^(?![-.])[\w.-]+$/;
const BRANCH = /^(?!-)(?!.*\.\.)[\w./-]+$/;

export type GithubRef = { owner: string; repo: string; branch: string | null };

export function parseGithubUrl(raw: string): GithubRef | null {
	let s = raw.trim();
	s = s.replace(/^git@github\.com:/, 'github.com/');
	s = s.replace(/^(?:https?:\/\/)?(?:www\.)?/, '');
	s = s.replace(/\.git$/, '');
	if (!s.startsWith('github.com/')) s = `github.com/${s}`;
	const m = GITHUB_URL.exec(s);
	if (!m) return null;
	const [, owner, repo, branch] = m;
	if (!NAME.test(owner) || !NAME.test(repo)) return null;
	if (branch !== undefined && !isValidBranch(branch)) return null;
	return { owner, repo, branch: branch ?? null };
}

export function isValidBranch(branch: string): boolean {
	return BRANCH.test(branch);
}
