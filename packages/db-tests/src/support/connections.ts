import { Client, Pool } from "pg";

// db/TESTING.md: same role split as dev, just pointed at cop_test. Every
// connection string below is overridable via env var (for CI, which
// provisions its own ephemeral cop_test + roles per run per TESTING.md),
// but always defaults to the documented cop_test / dev-only-password combo.
export const SUPERUSER_URL =
  process.env.COP_TEST_SUPERUSER_URL ?? "postgres://cop:cop_dev_only@localhost:5432/cop_test";

export const PUBLIC_API_URL =
  process.env.COP_TEST_PUBLIC_API_URL ??
  "postgres://cop_public_api:cop_public_dev_only@localhost:5432/cop_test";

export const INTERNAL_API_URL =
  process.env.COP_TEST_INTERNAL_API_URL ??
  "postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop_test";

const REQUIRED_DB_NAME = "cop_test";

/**
 * Structural guard against ever pointing this suite at the `cop` dev
 * database: every connection this suite opens goes through this function,
 * and it throws before a Pool is even constructed if the target database
 * isn't literally named `cop_test`. This is what db/TESTING.md means by "a
 * separate database makes it structurally impossible, not just a matter of
 * discipline" — enforced here in code, not just by convention.
 */
function assertTargetsCopTest(connectionString: string): void {
  let dbName: string;
  try {
    dbName = new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    throw new Error(`db-tests: could not parse connection string to verify target database.`);
  }
  if (dbName !== REQUIRED_DB_NAME) {
    throw new Error(
      `db-tests: refusing to connect — expected database "${REQUIRED_DB_NAME}" but this ` +
        `connection string targets "${dbName}". This suite must never touch anything but ` +
        `cop_test (see db/TESTING.md).`,
    );
  }
}

/** Create a pg Pool, after verifying it targets cop_test and nothing else. */
export function createPool(connectionString: string): Pool {
  assertTargetsCopTest(connectionString);
  return new Pool({ connectionString });
}

/** Create a single pg Client, after verifying it targets cop_test and nothing else. */
export function createClient(connectionString: string): Client {
  assertTargetsCopTest(connectionString);
  return new Client({ connectionString });
}
