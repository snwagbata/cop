import { defineConfig } from "vitest/config";

// db/TESTING.md: test files must run serially against the shared cop_test
// database, never in parallel — concurrent files would race on the same
// TRUNCATE/reseed cycle. `fileParallelism: false` runs test files one at a
// time; `singleFork: true` additionally keeps them all in one worker process
// so there's no ambiguity about overlapping DB state between files.
export default defineConfig({
  test: {
    globals: false,
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
