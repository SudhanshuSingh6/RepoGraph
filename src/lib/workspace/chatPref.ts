// Whether the chat panel is open, remembered in this browser across reloads and
// projects. Storage can be missing or blocked (private mode, disabled site data), so
// every access is guarded and anything unreadable means open, the default.

const KEY = 'repograph.chatOpen';

export function readChatOpen(): boolean {
	try {
		return globalThis.localStorage?.getItem(KEY) !== 'false';
	} catch {
		return true;
	}
}

export function writeChatOpen(open: boolean): void {
	try {
		globalThis.localStorage?.setItem(KEY, String(open));
	} catch {
		// not remembered: the panel still opens and closes for this page
	}
}
