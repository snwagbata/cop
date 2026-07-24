import express from "express";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { officersRouter } from "./routes/officers.js";
import { departmentsRouter } from "./routes/departments.js";
import { disputesRouter } from "./routes/disputes.js";
import { tipsRouter } from "./routes/tips.js";
import { ApiError, sendError } from "./lib/errors.js";

const ALLOWED_ORIGIN = process.env.PUBLIC_WEB_ORIGIN ?? "http://localhost:5173";

// Builds and exports the configured Express app, but does NOT call
// `.listen()` — that's left to `index.ts` so tests can import `app` and
// drive it with supertest (in-process) without binding a real port. See
// db/TESTING.md for why: other processes may have dev servers already
// bound to :4001 during test runs.
export const app = express();

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/public/officers", officersRouter);
app.use("/api/public/departments", departmentsRouter);
app.use("/api/public/disputes", disputesRouter);
app.use("/api/public/tips", tipsRouter);

// 404 for anything unmatched under /api/public
app.use("/api/public", (_req, res) => {
  sendError(res, 404, "not_found", "No such route.");
});

// Central error handler — turns thrown ApiError (or unexpected errors) into
// the shared ApiErrorResponse shape with the right status code.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    sendError(res, err.status, err.error, err.message);
    return;
  }
  // eslint-disable-next-line no-console
  console.error("Unhandled error", err);
  sendError(res, 500, "internal_error", "An unexpected error occurred.");
});
