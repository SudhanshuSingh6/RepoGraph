import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user && { username: locals.user.username, avatarUrl: locals.user.avatarUrl }
});
