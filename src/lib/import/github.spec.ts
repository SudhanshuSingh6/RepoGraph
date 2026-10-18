import { describe, expect, it } from 'vitest';
import { parseGithubUrl } from './github';

describe('parseGithubUrl', () => {
	it.each([
		['owner/repo', { owner: 'owner', repo: 'repo', branch: null }],
		['github.com/owner/repo', { owner: 'owner', repo: 'repo', branch: null }],
		['https://github.com/owner/repo', { owner: 'owner', repo: 'repo', branch: null }],
		['https://github.com/owner/repo/', { owner: 'owner', repo: 'repo', branch: null }],
		['https://www.github.com/owner/repo.git', { owner: 'owner', repo: 'repo', branch: null }],
		['git@github.com:owner/repo.git', { owner: 'owner', repo: 'repo', branch: null }],
		['github.com/o/r/tree/dev', { owner: 'o', repo: 'r', branch: 'dev' }],
		['github.com/o/r/tree/dev/src/a.ts', { owner: 'o', repo: 'r', branch: 'dev' }],
		[
			'https://github.com/o/my.repo/blob/v1.2/README.md',
			{ owner: 'o', repo: 'my.repo', branch: 'v1.2' }
		]
	])('%s', (raw, expected) => expect(parseGithubUrl(raw)).toEqual(expected));

	it.each([
		'',
		'owner',
		'gitlab.com/owner/repo',
		'github.com/owner',
		'github.com/-owner/repo',
		'github.com/owner/repo/tree/--upload-pack=x',
		'github.com/owner/repo/issues/1'
	])('rejects %j', (raw) => expect(parseGithubUrl(raw)).toBeNull());
});
