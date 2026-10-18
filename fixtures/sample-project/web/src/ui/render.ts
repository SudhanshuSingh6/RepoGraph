import type { State } from '../state/store';
import { formatName } from './format.js';

export function render(state: State) {
	const list = document.querySelector('#customers');
	if (!list) return;
	list.innerHTML = state.customers.map((c) => `<li>${formatName(c.name)}</li>`).join('');
}
