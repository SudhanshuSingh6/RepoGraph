import { createStore } from './state/store';
import { ApiClient } from './api/client';

const store = createStore();
const api = new ApiClient('/api');

api.listCustomers().then((customers) => store.set({ customers }));
