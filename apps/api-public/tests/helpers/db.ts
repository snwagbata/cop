import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

// Superuser role — used ONLY for test setup/teardown (TRUNCATE + reseed),
// never for exercising the app's own query logic. See db/TESTING.md: the
// cop_public_api role the app itself connects as can't TRUNCATE, by design.
const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://cop:cop_dev_only@localhost:5432/cop_test";

export const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_SQL_PATH = path.resolve(__dirname, "../../../../db/seed/0001_synthetic_sample_data.sql");
const seedSql = fs.readFileSync(SEED_SQL_PATH, "utf8");

// Every table in db/migrations/*.sql (CREATE TABLE), in no particular order
// — CASCADE handles FK dependency ordering. `department_stats` is a
// materialized view, not a table, so it isn't listed here; the seed file's
// own trailing `REFRESH MATERIALIZED VIEW` (run below) repopulates it.
const ALL_TABLES = [
  "departments",
  "reviewers",
  "sources",
  "officers",
  "officer_department_history",
  "incidents",
  "incident_officers",
  "outcomes",
  "citations",
  "review_queue",
  "record_revisions",
  "disputes",
  "reviewer_sessions",
];

/**
 * Resets `cop_test` to the known seed baseline (db/seed/0001_synthetic_sample_data.sql,
 * fixed UUIDs — see tests/helpers/fixtures.ts): TRUNCATE everything, then
 * re-run the seed inserts. Call from `beforeEach` in every test file per
 * db/TESTING.md's reset convention, so no test's mutations leak into
 * another test or file (test files run serially — see vitest.config.ts).
 */
export async function resetDb(): Promise<void> {
  await adminPool.query(`TRUNCATE TABLE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  // The seed file wraps its own inserts in BEGIN/COMMIT and ends with
  // `REFRESH MATERIALIZED VIEW department_stats` — running it verbatim
  // restores both the base tables and the derived stats view.
  await adminPool.query(seedSql);
}

export async function closeAdminPool(): Promise<void> {
  await adminPool.end();
}
