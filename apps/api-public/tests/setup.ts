// Runs before any test file's own imports (Vitest `setupFiles` semantics),
// which matters because `src/db.ts` reads `process.env.DATABASE_URL` at
// *module load* time to build its connection pool. Setting it here — before
// `src/app.ts` (and therefore `src/db.ts`) ever gets imported by a test file
// — guarantees the app under test always talks to `cop_test` via the
// read-only `cop_public_api` role, never the `cop` dev database. See
// db/TESTING.md.
process.env.DATABASE_URL ??=
  "postgres://cop_public_api:cop_public_dev_only@localhost:5432/cop_test";

// Match the app's dev default so the CORS test asserts against a known,
// documented origin rather than something the test suite invented.
process.env.PUBLIC_WEB_ORIGIN ??= "http://localhost:5173";
