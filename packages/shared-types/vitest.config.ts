import { defineConfig, configDefaults } from "vitest/config";

// vitest 4 changed its default include glob to also pick up compiled .js
// test files, not just source .ts — a real problem here because this
// package's tsconfig `include: ["src"]` compiles src/index.test.ts into
// dist/index.test.js (tests live directly in src/, unlike the apps, which
// keep tests in a separate tests/ directory tsc never touches). Without
// this exclude, `npm test` silently runs the same test twice, once from
// source and once from the stale-by-definition build output. Caught while
// validating the vitest 2->4 dependency bump.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
