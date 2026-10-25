import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChatOpen, writeChatOpen } from './chatPref.ts';

function memoryStorage() {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v)
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('chat panel preference', () => {
	it('is open when nothing is stored', () => {
		vi.stubGlobal('localStorage', memoryStorage());
		expect(readChatOpen()).toBe(true);
	});

	it('remembers closed and open', () => {
		vi.stubGlobal('localStorage', memoryStorage());
		writeChatOpen(false);
		expect(readChatOpen()).toBe(false);
		writeChatOpen(true);
		expect(readChatOpen()).toBe(true);
	});

	it('falls back to open, without throwing, when storage is blocked', () => {
		const blocked = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		vi.stubGlobal('localStorage', blocked);
		expect(() => writeChatOpen(false)).not.toThrow();
		expect(readChatOpen()).toBe(true);
		vi.stubGlobal('localStorage', undefined);
		expect(readChatOpen()).toBe(true);
	});
});
