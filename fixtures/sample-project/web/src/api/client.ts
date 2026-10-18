import type { State } from '../state/store';

export class ApiClient {
	constructor(private base: string) {}

	async listCustomers(): Promise<State['customers']> {
		const res = await fetch(`${this.base}/customers`);
		return res.json();
	}
}
