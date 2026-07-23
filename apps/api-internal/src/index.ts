import express from "express";
import cors from "cors";
import type { ErrorRequestHandler } from "express";
import { authRouter } from "./routes/auth.js";
import { reviewQueueRouter } from "./routes/reviewQueue.js";
import { disputesRouter } from "./routes/disputes.js";
import { departmentsRouter } from "./routes/departments.js";
import { officersRouter } from "./routes/officers.js";
import { sourcesRouter } from "./routes/sources.js";
import { incidentsRouter } from "./routes/incidents.js";
import { outcomesRouter } from "./routes/outcomes.js";
import { citationsRouter } from "./routes/citations.js";
import { reviewersRouter } from "./routes/reviewers.js";
import { recordRevisionsRouter } from "./routes/recordRevisions.js";
import { requireAuth } from "./auth.js";
import { sendError, ApiError } from "./errors.js";

const PORT = Number(process.env.PORT ?? 4002);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5175";

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Auth: login is unauthenticated; everything else under /api/internal
// requires a valid bearer token (DESIGN.md §7, §8 -- internal-only surface).
app.use("/api/internal/auth", authRouter);
app.use("/api/internal/review-queue", requireAuth, reviewQueueRouter);
app.use("/api/internal/disputes", requireAuth, disputesRouter);

// Manual data entry (DESIGN.md Phase 1 / post-MVP build-out) -- reviewer-
// authored creates that bypass review_queue since a reviewer is entering the
// record directly rather than an ingestion pipeline proposing it.
app.use("/api/internal/departments", requireAuth, departmentsRouter);
app.use("/api/internal/officers", requireAuth, officersRouter);
app.use("/api/internal/sources", requireAuth, sourcesRouter);
app.use("/api/internal/incidents", requireAuth, incidentsRouter);
app.use("/api/internal/outcomes", requireAuth, outcomesRouter);
app.use("/api/internal/citations", requireAuth, citationsRouter);

// Reviewer management is admin-role-only; the role check itself lives inside
// reviewersRouter (as middleware) since it needs req.reviewer, which
// requireAuth has already populated by the time it runs.
app.use("/api/internal/reviewers", requireAuth, reviewersRouter);

app.use("/api/internal/record-revisions", requireAuth, recordRevisionsRouter);

app.use((req, res) => {
  sendError(res, 404, "not_found", `No route for ${req.method} ${req.path}`);
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    sendError(res, err.status, err.code, err.message);
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  sendError(res, 500, "internal_error", "Unexpected server error.");
};
app.use(errorHandler);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`api-internal listening on port ${PORT} (CORS origin: ${ALLOWED_ORIGIN})`);
});
