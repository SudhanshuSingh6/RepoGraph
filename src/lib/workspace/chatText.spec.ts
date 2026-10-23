import { describe, expect, it } from 'vitest';
import { chatBlocks, inlineParts } from './chatText.ts';

describe('chatBlocks', () => {
	it('splits prose and fenced code, keeping the language', () => {
		const text = 'Look at `main()`:\n\n```ts\nconst a = 1;\nconst b = `x`;\n```\nThat is all.';
		expect(chatBlocks(text)).toEqual([
			{
				kind: 'text',
				parts: [
					{ code: false, text: 'Look at ' },
					{ code: true, text: 'main()' },
					{ code: false, text: ':' }
				]
			},
			{ kind: 'code', lang: 'ts', text: 'const a = 1;\nconst b = `x`;' },
			{ kind: 'text', parts: [{ code: false, text: 'That is all.' }] }
		]);
	});

	it('closes an unterminated fence at the end of the reply', () => {
		expect(chatBlocks('```\nhalf')).toEqual([{ kind: 'code', lang: '', text: 'half' }]);
	});

	it('leaves markup as text', () => {
		expect(chatBlocks('<img src=x onerror=alert(1)>')).toEqual([
			{ kind: 'text', parts: [{ code: false, text: '<img src=x onerror=alert(1)>' }] }
		]);
	});
});

describe('inlineParts', () => {
	it('does not treat an unmatched backtick as code', () => {
		expect(inlineParts('a ` b')).toEqual([{ code: false, text: 'a ` b' }]);
	});
});
