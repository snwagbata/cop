# Test database convention

Every automated test suite in this repo that touches Postgres (both API
services, and the DB constraint suite) uses a **dedicated database named
`cop_test`** — never the `cop` dev database that carries hand-verified seed
data. This is a hard rule, not a preference: this project has repeatedly
had to do full `TRUNCATE ... RESTART IDENTITY CASCADE` + reseed cleanups
after parallel agent work left test debris in the shared dev database (see
commit history and `README.md`'s "A note on parallel-agent verification
debris" section). Automated tests must never risk that again — a separate
database makes it structurally impossible, not just a matter of discipline.

## One-time setup (already done for local dev in this environment)

```
createdb cop_test   # or: psql -c "CREATE DATABASE cop_test OWNER cop;"
DATABASE_URL="postgres://cop:cop_dev_only@localhost:5432/cop_test" ./db/migrate.sh
DATABASE_URL="postgres://cop:cop_dev_only@localhost:5432/cop_test" ./db/seed.sh
```

The `cop_public_api`/`cop_internal_api` roles created by migration `0015`
are server-wide (not per-database), and that migration's `GRANT CONNECT`
targets `current_database()` dynamically — so running migrations against
`cop_test` automatically grants both roles the same access there that they
have on `cop`. No separate role setup needed.

## Convention for test suites

- Connection strings, same role split as dev, just pointed at `cop_test`:
  - `postgres://cop_public_api:cop_public_dev_only@localhost:5432/cop_test`
  - `postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop_test`
  - `postgres://cop:cop_dev_only@localhost:5432/cop_test` (superuser — only
    for test setup/teardown that needs privileges the app roles don't have,
    e.g. `TRUNCATE`, never for testing application query logic itself)
- Reset to the known seed baseline (`db/seed/0001_synthetic_sample_data.sql`,
  fixed UUIDs — the same ones documented in that file's header) in a
  `beforeAll`/`beforeEach` via `TRUNCATE ... RESTART IDENTITY CASCADE` on all
  tables followed by re-running the seed inserts, rather than hand-rolling
  fixtures per test file. Read-only tests can assert directly against the
  known seed UUIDs/values. Tests that mutate state (create/approve/reject/
  resolve) should either use their own freshly-inserted rows or reset the DB
  again before/after, so no test's mutations leak into another test.
- **Run test files serially against `cop_test`, not in parallel** — configure
  the test runner (e.g. vitest's `fileParallelism: false`, or a single-fork
  pool) so concurrent files don't race on the same shared table truncation.
  Slower, but correctness matters more than speed for a small schema like
  this one, and flaky DB-race test failures are worse than either.
- CI (`.github/workflows/`) provisions its own ephemeral `cop_test` per run
  via a Postgres service container — the convention above is what makes that
  possible without any test-specific code branching for "am I in CI."

## Known limitation: local multi-agent contention

The serial-execution convention above makes one test *suite* (one workspace's
`npm run test`) safe against itself. It does **not** make multiple *separate*
test suites — or multiple concurrent agent sessions each running their own
`npm run test` — safe against each other, if they're pointed at the same
literal `cop_test` database on the same local Postgres instance. Two
independent background agents building test suites in this project (for
`apps/api-public` and `packages/db-tests`) both hit real, reproducible
`duplicate key`/`deadlock detected` failures caused by exactly this: a
sibling agent's test run truncating/reseeding `cop_test` mid-run of another.

This is a property of the local sandbox (multiple worktree-isolated agent
sessions sharing one physical Postgres server), not of CI, where each run
gets a genuinely fresh, isolated database via a service container — so it
doesn't need fixing for CI to work correctly. For local development: **don't
run more than one workspace's test suite against `cop_test` at the same
time.** If you're not sure whether something else is using it, check for
other `vitest`/`tsx` processes before running tests, or wait and retry on a
failure that looks like DB contention rather than assuming it's a real bug.
