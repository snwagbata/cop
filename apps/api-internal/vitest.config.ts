import { defineConfig } from "vitest/config";

// db/TESTING.md: test files must run serially against the shared cop_test
// database (no fileParallelism), and every test file resets to the seed
// baseline itself rather than relying on execution order.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    env: {
      DATABASE_URL: "postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop_test",
    },
  },
});
