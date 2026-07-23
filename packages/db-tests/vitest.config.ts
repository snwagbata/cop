import { defineConfig } from "vitest/config";

// db/TESTING.md: all test files in this suite share one cop_test database
// and reset it (TRUNCATE + reseed) around themselves, so files must never
// run concurrently against it — fileParallelism: false forces vitest to run
// test files one at a time (still one process/pool, just serial) instead of
// its default of scheduling multiple files' tests concurrently.
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
