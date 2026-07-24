import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, SUPERUSER_URL } from "./connections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/ingestion-lib/src/support/reset.ts -> repo root is four levels up.
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SEED_SQL_PATH = path.join(REPO_ROOT, "db", "seed", "0001_synthetic_sample_data.sql");

// Same table list/ordering as packages/db-tests/src/support/reset.ts --
// kept in sync manually (mirrors that package's own comment: CASCADE is the
// real safety net for anything this list misses). Excludes ingestion_runs
// and ingestion_configs deliberately: this package's own tests populate and
// assert against those tables directly and reset them per-test via
// truncateIngestionTables below, not as part of the shared seed-reset.
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

// Same advisory-lock pattern as db-tests's reset.ts -- serializes the
// TRUNCATE+reseed critical section even if something overlaps
// vitest.config.ts's fileParallelism:false guarantee. A different fixed key
// than db-tests uses, so the two packages' locks never collide if they
// somehow ever run against the same server concurrently.
const RESET_LOCK_KEY = 727_100_002;

/** Reset the test database to the documented seed baseline (db/TESTING.md) --
 * see db-tests/src/support/reset.ts for the identical pattern this mirrors. */
export async function resetTestDatabase(): Promise<void> {
  const client = createClient(SUPERUSER_URL);
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [RESET_LOCK_KEY]);
    await client.query(`TRUNCATE TABLE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    await client.query("TRUNCATE TABLE ingestion_runs, ingestion_configs");
    await client.query(loadSeedSql());
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [RESET_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}
