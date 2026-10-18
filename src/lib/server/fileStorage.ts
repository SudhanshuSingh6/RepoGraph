// The one place file source text is read or written (the worker's mirror is
// workers/file_storage.py). Today it's the parsed_files.content column; swapping the
// internals to blob storage (S3/R2) later changes nothing for callers.
import { selectFileContent, updateFileContent } from '#lib/server/db/fileContents.ts';

export function readContent(fileId: string): Promise<string | null> {
	return selectFileContent(fileId);
}

export function writeContent(fileId: string, text: string): Promise<void> {
	return updateFileContent(fileId, text);
}
