import { defineConfig, configDefaults } from "vitest/config";

// db/TESTING.md: this suite's tests connect directly to Postgres (no HTTP
// layer, same pattern as packages/db-tests), so files must run serially
// against whatever cop_test-style database they're pointed at --
// fileParallelism: false forces vitest to run test files one at a time
// instead of scheduling multiple files' tests concurrently.
//
// dist/** is excluded for the same reason packages/shared-types/vitest.config.ts
// excludes it: tsconfig's include: ["src"] compiles src/tests/*.test.ts into
// dist/tests/*.test.js, and vitest 4's broader default include glob would
// otherwise pick up and re-run those stale compiled copies alongside the
// real source tests.
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
