import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Superuser connection -- only for test setup/teardown (TRUNCATE/reseed),
// per db/TESTING.md. Application code under test must never use this pool;
// it goes through src/db.ts's cop_internal_api-role pool instead, so tests
// exercise the real, more-restricted grants the app runs with in production.
export const superPool = new Pool({
  connectionString:
    process.env.SUPERUSER_DATABASE_URL ?? "postgres://cop:cop_dev_only@localhost:5432/cop_test",
});

const SEED_FILE = path.resolve(__dirname, "../../../db/seed/0001_synthetic_sample_data.sql");

const ALL_TABLES = [
  "reviewer_sessions",
  "record_revisions",
  "review_queue",
  "disputes",
  "citations",
  "outcomes",
  "incident_officers",
  "incidents",
  "officer_department_history",
  "officers",
  "sources",
  "departments",
  "reviewers",
];

/**
 * Test-only reviewer accounts, bootstrapped after every reset the same way
 * scripts/create-admin.ts bootstraps a real reviewer (bcrypt hash, upsert by
 * email) -- but with fixed, test-suite-specific UUIDs/emails/passwords so
 * tests can log in deterministically without depending on the seed file's
 * NULL-password 'reviewer@example.org' row. Passwords are specific to this
 * suite (not reused from any other doc/script in this repo).
 */
export const TEST_ADMIN = {
  id: "10000000-0000-0000-0000-000000000001",
  name: "Internal Test Admin",
  email: "internal-test-admin@cop-tests.example",
  password: process.env.TEST_ADMIN_PASSWORD ?? "int-api-test-admin-pw-7q2k",
  role: "admin" as const,
};

export const TEST_REVIEWER = {
  id: "10000000-0000-0000-0000-000000000002",
  name: "Internal Test Reviewer",
  email: "internal-test-reviewer@cop-tests.example",
  password: process.env.TEST_REVIEWER_PASSWORD ?? "int-api-test-reviewer-pw-9m4t",
  role: "reviewer" as const,
};

let seedSql: string | undefined;
function readSeedSql(): string {
  if (!seedSql) {
    seedSql = fs.readFileSync(SEED_FILE, "utf8");
  }
  return seedSql;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resets cop_test to the known seed baseline plus this suite's two
 * bootstrapped reviewer accounts. Run before every test that reads or
 * mutates DB state (see db/TESTING.md) so no test's writes leak into
 * another test, and file-level parallelism is disabled in vitest.config.ts
 * so concurrent files never race on the same truncation.
 *
 * Runs as one transaction on one checked-out connection (rather than four
 * separate pool.query calls) to shrink the window in which some other
 * process sharing this same cop_test database could truncate/reseed
 * concurrently and interleave with this one -- and retries a few times on
 * the transient errors that kind of interleaving produces (duplicate key,
 * deadlock, serialization failure), since db/TESTING.md's whole premise is
 * that cop_test is genuinely shared, not that this suite is its only user.
 */
export async function resetDb(): Promise<void> {
  const adminHash = await bcrypt.hash(TEST_ADMIN.password, 10);
  const reviewerHash = await bcrypt.hash(TEST_REVIEWER.password, 10);
  const seed = readSeedSql();

  const RETRYABLE_CODES = new Set(["23505", "40P01", "40001"]);
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = await superPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`TRUNCATE TABLE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
      await client.query(seed);
      await client.query(
        `INSERT INTO reviewers (id, name, email, role, active, password_hash)
         VALUES ($1, $2, $3, $4, true, $5)`,
        [TEST_ADMIN.id, TEST_ADMIN.name, TEST_ADMIN.email, TEST_ADMIN.role, adminHash],
      );
      await client.query(
        `INSERT INTO reviewers (id, name, email, role, active, password_hash)
         VALUES ($1, $2, $3, $4, true, $5)`,
        [TEST_REVIEWER.id, TEST_REVIEWER.name, TEST_REVIEWER.email, TEST_REVIEWER.role, reviewerHash],
      );
      await client.query("COMMIT");
      return;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
      if (attempt < MAX_ATTEMPTS && code && RETRYABLE_CODES.has(code)) {
        await sleep(100 * attempt);
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function closeSuperPool(): Promise<void> {
  await superPool.end();
}
