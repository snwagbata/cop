import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop";

export const pool = new Pool({ connectionString });

/**
 * Convenience wrapper so callers don't juggle pool.connect()/release()
 * for single-statement queries; use pool.connect() directly for
 * multi-statement transactions (see reviewQueue.ts approve handler).
 */
export function query<T extends pg.QueryResultRow = any>(text: string, params?: unknown[]) {
  return pool.query<T>(text, params);
}

/**
 * Minimal shape both `pool` and a checked-out `PoolClient` satisfy -- lets
 * helper functions (e.g. writeRecordRevision) run either as part of a
 * multi-statement transaction (pass the client) or standalone (pass `pool`)
 * without depending on the concrete pg type.
 */
export type Queryable = {
  query: <T extends pg.QueryResultRow = any>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};
