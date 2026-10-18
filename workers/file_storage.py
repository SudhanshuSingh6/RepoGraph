"""The worker's half of the file-content storage seam (the app's half is
src/lib/server/fileStorage.ts). Source text is only ever written through here, so it
can move from the Postgres `content` column to blob storage without touching callers."""

import psycopg


def write_contents(cur: psycopg.Cursor, items: list[tuple[str, str]]) -> None:
    """items: (parsed_files.id, source text)."""
    cur.executemany("update parsed_files set content = %s where id = %s",
                    [(text, file_id) for file_id, text in items])
