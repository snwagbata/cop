import { defineConfig } from "vitest/config";

// db/TESTING.md: run.test.ts hits a real Postgres test database, so test
// files must run serially (no fileParallelism) against it -- same
// convention as every other DB-backed test suite in this repo. client.test.ts
// and extract.test.ts don't touch Postgres at all (mocked fetch / mocked
// Anthropic client), but keeping the whole suite serial is simpler and
// cheap at this size.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
