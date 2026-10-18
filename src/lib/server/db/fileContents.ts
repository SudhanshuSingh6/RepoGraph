import { db } from './client';

// Only src/lib/server/fileStorage.ts should call these.

export async function selectFileContent(fileId: string): Promise<string | null> {
	const [row] = await db()`select content from parsed_files where id = ${fileId}`;
	return row?.content ?? null;
}

export async function updateFileContent(fileId: string, text: string): Promise<void> {
	await db()`update parsed_files set content = ${text} where id = ${fileId}`;
}
