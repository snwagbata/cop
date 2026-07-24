import { defineConfig } from "vitest/config";

// db/TESTING.md: test files must run serially against the shared cop_test
// database, never in parallel — concurrent files would race on the same
// TRUNCATE/reseed cycle. `fileParallelism: false` runs test files one at a
// time; under vitest 4 this alone also forces maxWorkers to 1 (previously
// needed poolOptions.forks.singleFork, removed in vitest 4's pool rework),
// so all files run in one worker process with no ambiguity about
// overlapping DB state between files.
export default defineConfig({
  test: {
    globals: false,
    fileParallelism: false,
    pool: "forks",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
