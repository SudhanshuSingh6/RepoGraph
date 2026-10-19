import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Sample project served to users as data, not app code.
	{ ignores: ['fixtures/**'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Repository-function convention: only src/lib/server/db/*.ts may touch the
		// database client; everything else calls named functions exported from there.
		ignores: ['src/lib/server/db/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							regex: '(^#lib/server/db/client|/server/db/client)(\\.(js|ts))?$',
							message:
								'Query the database through a named function in src/lib/server/db/*.ts, not the client directly.'
						},
						{
							group: ['postgres'],
							message: 'Only src/lib/server/db/*.ts may import the postgres driver.'
						}
					]
				}
			]
		}
	},
	{
		// packages/analysis is pure functions in, data out — liftable into its own
		// service later (README scaling table), so it must not depend on the app.
		files: ['packages/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							regex: '^(\\$app|\\$lib|#lib|@sveltejs)(/|$)',
							message: 'packages/analysis must not import SvelteKit or app code.'
						},
						{ group: ['postgres', 'svelte', 'svelte/*'], message: 'packages/analysis is pure.' }
					]
				}
			]
		}
	},
	{
		// The migration runner is a standalone script outside the app.
		files: ['db/**'],
		rules: { 'no-restricted-imports': 'off' }
	}
);
