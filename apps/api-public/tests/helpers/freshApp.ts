import { vi } from "vitest";
import type { Express } from "express";

/**
 * Returns a freshly constructed Express app by clearing Vitest's module
 * registry and re-importing src/app.js.
 *
 * Why: src/middleware/rateLimit.ts's limiter state (a plain in-memory Map)
 * lives at module scope, keyed by `req.ip`. Every request supertest sends
 * to an in-process app shares the same loopback `req.ip`, and the app has
 * no `trust proxy` / X-Forwarded-For override to let a test pick a
 * "dedicated" key. The closest equivalent this design allows is a
 * dedicated *module instance*: re-importing src/app.js after
 * `vi.resetModules()` re-evaluates rateLimit.ts's `createRateLimiter(...)`
 * call, producing a brand-new, empty hits Map. Use this per-test in any
 * disputes test that hits POST /api/public/disputes, so one test's
 * requests can never count toward another test's rate-limit window.
 */
export async function freshApp(): Promise<Express> {
  vi.resetModules();
  const mod = await import("../../src/app.js");
  return mod.app;
}
