import type { NextFunction, Request, Response } from "express";
import { sendError } from "../lib/errors.js";

/**
 * Minimal in-memory, fixed-window rate limiter.
 *
 * DEV-ONLY, NOT PRODUCTION-HARDENED:
 *  - State is a plain in-process Map, so it resets on every restart and is
 *    NOT shared across multiple instances/replicas — behind a load balancer
 *    with >1 process this allows N * numInstances requests, not N.
 *  - Keys off `req.ip`, which is trivially spoofable/rotatable and unreliable
 *    behind proxies unless `trust proxy` is configured correctly upstream.
 *  - No persistence, no distributed store (Redis, etc).
 * Before any real deployment, replace with a proper rate-limiting layer
 * (e.g. a shared Redis-backed limiter or an edge/WAF-level control) — see
 * DESIGN.md §9 on rate limiting and anti-bulk-harvesting controls.
 */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; windowStart: number }>();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now - entry.windowStart >= opts.windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    if (entry.count >= opts.max) {
      sendError(
        res,
        429,
        "rate_limited",
        "Too many requests. Please wait before submitting another dispute."
      );
      return;
    }

    entry.count += 1;
    next();
  };
}
