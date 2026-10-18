import { render } from '../ui/render';

export type State = { customers: { id: number; name: string }[] };

export function createStore(initial: State = { customers: [] }) {
	let state = initial;
	return {
		get: () => state,
		set(next: State) {
			state = next;
			render(state);
		}
	};
}
