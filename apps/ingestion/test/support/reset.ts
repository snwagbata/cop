import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { SUPERUSER_URL } from "./connections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/ingestion/test/support/reset.ts -> repo root is four levels up.
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SEED_SQL_PATH = path.join(REPO_ROOT, "db", "seed", "0001_synthetic_sample_data.sql");

// Same table list as packages/ingestion-lib/src/support/reset.ts, but this
// suite's own database (cop_test_courtlistener) is fully isolated -- no
// other suite shares it -- so unlike that package's reset.ts, ingestion_runs
// and ingestion_configs ARE included in the normal reset here: run.test.ts
// asserts against both directly and expects a clean slate every test.
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
  "ingestion_runs",
  "ingestion_configs",
] as const;

let cachedSeedSql: string | null = null;
function loadSeedSql(): string {
  if (cachedSeedSql === null) {
    cachedSeedSql = readFileSync(SEED_SQL_PATH, "utf8");
  }
  return cachedSeedSql;
}

// Distinct advisory-lock key from both packages/db-tests and
// packages/ingestion-lib's reset locks, so none of the three ever collide
// if they somehow run against the same Postgres server concurrently.
const RESET_LOCK_KEY = 727_100_003;

/** Reset apps/ingestion's dedicated test database (cop_test_courtlistener)
 * to the documented seed baseline (db/TESTING.md), with ingestion_runs and
 * ingestion_configs also cleared -- see ALL_TABLES comment above. */
export async function resetTestDatabase(): Promise<void> {
  const client = new Client({ connectionString: SUPERUSER_URL });
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
