import JSZip from 'jszip';

// The built-in sample (fixtures/sample-project), zipped on the server. Anyone may import
// it without signing in, so its bytes must come from here, never from the request.
const modules = import.meta.glob<string>('/fixtures/sample-project/**/*', {
	query: '?raw',
	import: 'default'
});

let archive: Promise<Uint8Array> | undefined;

export function sampleArchive(): Promise<Uint8Array> {
	archive ??= (async () => {
		const zip = new JSZip();
		for (const [key, load] of Object.entries(modules)) {
			zip.file(key.replace('/fixtures/', ''), await load());
		}
		return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
	})().catch((e) => {
		archive = undefined;
		throw e;
	});
	return archive;
}
