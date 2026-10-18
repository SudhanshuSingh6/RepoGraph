import { ApiClient } from './client';

test('builds the customers URL', async () => {
	globalThis.fetch = async (url) => ({ json: async () => [{ id: 1, name: String(url) }] });
	const [c] = await new ApiClient('/api').listCustomers();
	expect(c.name).toBe('/api/customers');
});
