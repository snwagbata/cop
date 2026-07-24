import { Client, Pool } from "pg";

// db/TESTING.md: same role split as dev, just pointed at cop_test by
// default. Every connection string below is overridable via env var (same
// pattern as packages/db-tests/src/support/connections.ts) -- in
// particular, local runs of this suite alongside another worktree-isolated
// agent's test run should point these at a dedicated database (e.g.
// cop_test_ingestion) rather than sharing the literal cop_test database, per
// db/TESTING.md's "Known limitation: local multi-agent contention" section.
export const SUPERUSER_URL =
  process.env.COP_TEST_SUPERUSER_URL ?? "postgres://cop:cop_dev_only@localhost:5432/cop_test";

export const INTERNAL_API_URL =
  process.env.COP_TEST_INTERNAL_API_URL ??
  "postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop_test";

export const PUBLIC_API_URL =
  process.env.COP_TEST_PUBLIC_API_URL ??
  "postgres://cop_public_api:cop_public_dev_only@localhost:5432/cop_test";

/**
 * The literal database name every connection above must target, derived
 * from SUPERUSER_URL so this guard adapts automatically when the whole
 * trio is pointed at a different test database via env vars (e.g.
 * cop_test_ingestion) -- it only ever enforces "all three connections agree
 * with each other," not a single hardcoded name.
 */
function requiredDbName(): string {
  return new URL(SUPERUSER_URL).pathname.replace(/^\//, "");
}

/**
 * Structural guard against ever pointing this suite at the `cop` dev
 * database, or at a different test database than the other connections in
 * this module -- mirrors db-tests/src/support/connections.ts's
 * assertTargetsCopTest, generalized so this package's env-var overrides
 * stay internally consistent.
 */
function assertTargetsTestDatabase(connectionString: string): void {
  let dbName: string;
  try {
    dbName = new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    throw new Error("ingestion-lib: could not parse connection string to verify target database.");
  }
  const required = requiredDbName();
  if (dbName === "cop") {
    throw new Error(
      "ingestion-lib: refusing to connect -- this suite must never touch the `cop` dev database.",
    );
  }
  if (dbName !== required) {
    throw new Error(
      `ingestion-lib: refusing to connect -- expected database "${required}" (from SUPERUSER_URL) but ` +
        `this connection string targets "${dbName}". Point every COP_TEST_*_URL env var at the same database.`,
    );
  }
}

export function createPool(connectionString: string): Pool {
  assertTargetsTestDatabase(connectionString);
  return new Pool({ connectionString });
}

export function createClient(connectionString: string): Client {
  assertTargetsTestDatabase(connectionString);
  return new Client({ connectionString });
}
