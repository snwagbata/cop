import { Pool } from "pg";

// db/TESTING.md, and packages/ingestion-lib/src/support/connections.ts's
// identical pattern: a dedicated database, never the shared `cop_test` that
// other suites truncate/reseed, and never the `cop` dev database. Per this
// task's brief, this suite's own database is `cop_test_courtlistener` --
// overridable via env var for CI or a differently-named local setup.
export const SUPERUSER_URL =
  process.env.INGESTION_TEST_SUPERUSER_URL ?? "postgres://cop:cop_dev_only@localhost:5432/cop_test_courtlistener";

export const INTERNAL_API_URL =
  process.env.INGESTION_TEST_INTERNAL_API_URL ??
  "postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop_test_courtlistener";

function requiredDbName(): string {
  return new URL(SUPERUSER_URL).pathname.replace(/^\//, "");
}

/** Structural guard against ever pointing this suite at the shared
 * `cop_test` database (which other suites truncate/reseed concurrently --
 * db/TESTING.md's "Known limitation: local multi-agent contention") or the
 * `cop` dev database -- mirrors packages/ingestion-lib's identical guard. */
function assertTargetsTestDatabase(connectionString: string): void {
  let dbName: string;
  try {
    dbName = new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    throw new Error("apps/ingestion tests: could not parse connection string to verify target database.");
  }
  const required = requiredDbName();
  if (dbName === "cop") {
    throw new Error("apps/ingestion tests: refusing to connect -- this suite must never touch the `cop` dev database.");
  }
  if (dbName !== required) {
    throw new Error(
      `apps/ingestion tests: refusing to connect -- expected database "${required}" (from SUPERUSER_URL) but ` +
        `this connection string targets "${dbName}". Point every INGESTION_TEST_*_URL env var at the same database.`,
    );
  }
}

export function createPool(connectionString: string): Pool {
  assertTargetsTestDatabase(connectionString);
  return new Pool({ connectionString });
}
