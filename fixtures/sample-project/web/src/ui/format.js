import { createStore } from '../state/store';

// Deliberately closes the import cycle store → render → format → store.
export const defaultStore = createStore();

export function formatName(name) {
	return name.trim().replace(/\s+/g, ' ');
}
