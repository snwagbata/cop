import { defineConfig, configDefaults } from "vitest/config";

// db/TESTING.md: all test files in this suite share one cop_test database
// and reset it (TRUNCATE + reseed) around themselves, so files must never
// run concurrently against it — fileParallelism: false forces vitest to run
// test files one at a time (still one process/pool, just serial) instead of
// its default of scheduling multiple files' tests concurrently.
//
// This package has no build script today, so dist/ doesn't normally exist —
// but tsconfig's include: ["src"] would compile tests/*.test.ts into
// dist/*.test.js exactly like packages/shared-types did (see that package's
// vitest.config.ts for the real incident this caused under vitest 4's
// broader default include glob). Excluding dist/ defensively now, before
// anyone adds a build step here and silently starts double-running tests.
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
