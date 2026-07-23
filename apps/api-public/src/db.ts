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

// Hosted Postgres (Render, Railway, Supabase, Neon, ...) requires SSL on
// external connections and typically presents a cert that isn't in Node's
// default trust store — local dev (bare `localhost`) never needs this, so
// gate it behind an explicit env var rather than always requiring it.
// rejectUnauthorized: false accepts the provider's cert without full chain
// validation, which is the standard pattern for these providers' managed
// Postgres (the connection is still encrypted, just not cert-pinned) —
// acceptable here since this service only ever holds read-only/demo
// synthetic data, not something warranting stricter cert validation.
const useSsl = process.env.PGSSLMODE === "require";

export const pool = new Pool({ connectionString, ssl: useSsl ? { rejectUnauthorized: false } : undefined });

pool.on("error", (err) => {
  // Unexpected errors on idle clients — log and keep the process alive.
  // eslint-disable-next-line no-console
  console.error("Unexpected Postgres pool error", err);
});
