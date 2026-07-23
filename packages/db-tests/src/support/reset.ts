import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, SUPERUSER_URL } from "./connections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/db-tests/src/support/reset.ts -> repo root is four levels up.
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SEED_SQL_PATH = path.join(REPO_ROOT, "db", "seed", "0001_synthetic_sample_data.sql");

// Every table in the schema, in an order that's safe to TRUNCATE together in
// one statement (TRUNCATE resolves the full set including anything pulled in
// by CASCADE before touching any of them, so listing every table explicitly
// here is really just documentation — CASCADE is the actual safety net for
// any FK-referencing table this list ever misses). Deliberately excludes
// department_stats: it's a materialized view, not a table, and can't be
// TRUNCATEd — REFRESH MATERIALIZED VIEW (done by the seed script itself)
// is what brings it back in sync after a reset.
const ALL_TABLES = [
  "reviewer_sessions",
  "record_revisions",
  "review_queue",
  "disputes",
  "citations",
  "incident_officers",
  "outcomes",
  "incidents",
  "officer_department_history",
  "officers",
  "sources",
  "reviewers",
  "departments",
] as const;

let cachedSeedSql: string | null = null;
function loadSeedSql(): string {
  if (cachedSeedSql === null) {
    cachedSeedSql = readFileSync(SEED_SQL_PATH, "utf8");
  }
  return cachedSeedSql;
}

// Arbitrary fixed key for a Postgres session-level advisory lock guarding
// the TRUNCATE+reseed critical section below. db/TESTING.md requires test
// files to run serially against cop_test specifically so resets never race
// each other; vitest.config.ts's fileParallelism:false is what's supposed
// to guarantee that, but advisory-locking the reset itself here means an
// accidental overlapping invocation (e.g. two test processes pointed at the
// same cop_test at once) queues instead of racing/deadlocking on the
// TRUNCATE's table locks — cheap, self-contained insurance for exactly the
// property this suite depends on.
const RESET_LOCK_KEY = 727_100_001;

/**
 * Reset cop_test to the documented seed baseline per db/TESTING.md:
 * TRUNCATE ... RESTART IDENTITY CASCADE on every table, then re-run the
 * seed file's inserts verbatim (which also REFRESHes department_stats at
 * the end). Uses the superuser connection — the one privileged operation
 * this suite performs — never the app roles, and never against anything
 * but cop_test (enforced by createClient/assertTargetsCopTest).
 *
 * Safe to call in beforeAll (for read-only test files) or beforeEach (for
 * files whose tests mutate data and must not leak state to one another).
 */
export async function resetTestDatabase(): Promise<void> {
  const client = createClient(SUPERUSER_URL);
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [RESET_LOCK_KEY]);
    await client.query(`TRUNCATE TABLE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    await client.query(loadSeedSql());
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [RESET_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}
