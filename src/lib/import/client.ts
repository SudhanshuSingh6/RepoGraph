// Browser-side import: collect a picked/dropped folder (or a .zip, or the bundled sample),
// drop everything the worker would ignore anyway, zip it, and POST it to /api/projects.
import JSZip from 'jszip';
import { keepPath } from './filters';

export type ImportLimits = { maxBytes: number; maxFiles: number };
export type Progress = (message: string, fraction: number | null) => void;

type PickedFile = { path: string; file: Blob };

export class ImportError extends Error {}

/** From <input type="file" webkitdirectory>: paths are `folder/sub/file`. */
export function filesFromInput(list: FileList): { name: string; files: PickedFile[] } {
	const files = Array.from(list, (file) => ({ path: file.webkitRelativePath || file.name, file }));
	return { name: files[0]?.path.split('/')[0] || 'Uploaded project', files };
}

/**
 * From a drop: a single .zip is uploaded as-is; otherwise folders are walked via
 * webkitGetAsEntry (repograph-spec.md §5.2).
 */
export async function filesFromDrop(
	dt: DataTransfer
): Promise<{ zip: File } | { name: string; files: PickedFile[] }> {
	const entries = Array.from(dt.items)
		.map((item) => item.webkitGetAsEntry?.())
		.filter((e): e is FileSystemEntry => !!e);

	if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) {
		return { zip: await entryFile(entries[0] as FileSystemFileEntry) };
	}
	const files: PickedFile[] = [];
	for (const entry of entries) await walk(entry, entry.name, files);
	const name =
		entries.length === 1 && entries[0].isDirectory ? entries[0].name : 'Uploaded project';
	return { name, files };
}

async function walk(entry: FileSystemEntry, path: string, out: PickedFile[]): Promise<void> {
	if (entry.isFile) {
		if (keepPath(stripRoot(path)))
			out.push({ path, file: await entryFile(entry as FileSystemFileEntry) });
		return;
	}
	if (!entry.isDirectory) return;
	const reader = (entry as FileSystemDirectoryEntry).createReader();
	// readEntries returns batches; keep reading until it returns an empty one.
	for (;;) {
		const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
		if (batch.length === 0) break;
		for (const child of batch) {
			// Don't descend into ignored folders (node_modules etc.) at all.
			if (child.isDirectory && !keepPath(`${stripRoot(`${path}/${child.name}`)}/x.js`)) continue;
			await walk(child, `${path}/${child.name}`, out);
		}
	}
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
	return new Promise((res, rej) => entry.file(res, rej));
}

/** Paths are filtered relative to the chosen folder, so a folder named e.g. `build` isn't skipped. */
function stripRoot(path: string): string {
	const i = path.indexOf('/');
	return i < 0 ? path : path.slice(i + 1);
}

/** The bundled sample project (fixtures/sample-project), loaded only when asked for. */
export async function zipFiles(
	files: PickedFile[],
	limits: ImportLimits,
	progress: Progress
): Promise<Blob> {
	const kept = files.filter((f) => keepPath(stripRoot(f.path)));
	if (kept.length === 0) {
		throw new ImportError(
			'No Java, JavaScript, TypeScript or Python files were found in that folder.'
		);
	}
	if (kept.length > limits.maxFiles) {
		throw new ImportError(`That project has more than ${limits.maxFiles.toLocaleString()} files.`);
	}
	const total = kept.reduce((n, f) => n + f.file.size, 0);
	if (total > limits.maxBytes) throw new ImportError(tooLarge(limits));

	const zip = new JSZip();
	for (const f of kept) zip.file(f.path, f.file);
	progress(`Packing ${kept.length.toLocaleString()} files…`, 0);
	return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (meta) =>
		progress(`Packing ${kept.length.toLocaleString()} files…`, meta.percent / 100)
	);
}

/** POSTs an archive; uses XHR (not fetch) so upload progress can drive the bar. */
export function uploadArchive(
	archive: Blob,
	name: string,
	limits: ImportLimits,
	progress: Progress
): Promise<string> {
	if (archive.size > limits.maxBytes) return Promise.reject(new ImportError(tooLarge(limits)));
	const form = new FormData();
	form.append('name', name);
	form.append('archive', archive, `${name}.zip`);
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/projects');
		xhr.responseType = 'json';
		xhr.upload.onprogress = (e) =>
			progress('Uploading…', e.lengthComputable ? e.loaded / e.total : null);
		xhr.onload = () =>
			xhr.status === 201
				? resolve(xhr.response.id)
				: reject(new ImportError(xhr.response?.message ?? `Upload failed (${xhr.status}).`));
		xhr.onerror = () => reject(new ImportError('Upload failed — check your connection.'));
		xhr.send(form);
	});
}

export function importFromGithub(repo: string, branch: string): Promise<string> {
	return createProject({ github: repo, branch: branch || undefined });
}

/** The built-in sample — the server zips it, so this works signed out. */
export function importSample(): Promise<string> {
	return createProject({ sample: true });
}

async function createProject(payload: object): Promise<string> {
	const res = await fetch('/api/projects', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	const body = await res.json().catch(() => ({}));
	if (res.status !== 201) throw new ImportError(body.message ?? `Import failed (${res.status}).`);
	return body.id;
}

function tooLarge(limits: ImportLimits): string {
	return `Projects can be at most ${Math.floor(limits.maxBytes / (1024 * 1024))}MB.`;
}
