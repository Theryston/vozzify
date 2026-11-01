import { sql } from 'drizzle-orm';
import type { Database } from './database.js';

export type CatalogTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

// A database-wide fence keeps metadata replacement and association delivery
// ordered, and lets reimport cutover close admission before transferring state.
const CATALOG_WRITE_LOCK = 385_001;

export const withCatalogWriteLock = <Result>(
  db: Database,
  run: (transaction: CatalogTransaction) => Promise<Result>,
): Promise<Result> =>
  db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${CATALOG_WRITE_LOCK})`,
    );
    return run(transaction);
  });

export const acquireCatalogWriteLock = async (
  transaction: CatalogTransaction,
): Promise<void> => {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${CATALOG_WRITE_LOCK})`,
  );
};
