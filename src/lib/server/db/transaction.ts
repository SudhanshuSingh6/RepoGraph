import type postgres from 'postgres';
import { db } from './client';

/** A transaction handle. Pass it to repository functions that must share one transaction. */
export type Tx = postgres.TransactionSql;

export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
	return db().begin(fn) as Promise<T>;
}
