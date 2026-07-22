import pg from "pg";

const { Pool, types } = pg;

// Postgres OIDs: return `date` columns as plain "YYYY-MM-DD" strings (not JS
// Date objects, which would apply local-timezone shifting we don't want),
// and `timestamptz` as ISO strings, matching the wire format shared-types
// expects (see packages/shared-types/src/index.ts header comment).
const DATE_OID = 1082;
const TIMESTAMPTZ_OID = 1184;
const INT8_OID = 20; // bigint (e.g. outcomes.amount_cents) — pg returns these as strings by default.

types.setTypeParser(DATE_OID, (value: string) => value);
types.setTypeParser(TIMESTAMPTZ_OID, (value: string) => new Date(value).toISOString());
types.setTypeParser(INT8_OID, (value: string) => value);

const connectionString =
  process.env.DATABASE_URL ?? "postgres://cop_public_api:cop_public_dev_only@localhost:5432/cop";

export const pool = new Pool({ connectionString });

pool.on("error", (err) => {
  // Unexpected errors on idle clients — log and keep the process alive.
  // eslint-disable-next-line no-console
  console.error("Unexpected Postgres pool error", err);
});
