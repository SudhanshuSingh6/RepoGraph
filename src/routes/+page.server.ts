import { IMPORT_MAX_BYTES, IMPORT_MAX_FILES } from '$app/env/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	limits: { maxBytes: IMPORT_MAX_BYTES, maxFiles: IMPORT_MAX_FILES }
});
