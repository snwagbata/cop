import { Router } from "express";
import type { IngestionRun, ListIngestionRunsResponse } from "@cop/shared-types";
import { pool } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

export const ingestionRunsRouter = Router();

// Most recent N runs is plenty for "can a reviewer see at a glance which
// pipelines are healthy" (INGESTION_DESIGN.md §5) -- unlike
// record-revisions.ts this deliberately skips full pagination, since this
// is a health-check list, not a browsable archive.
const RECENT_RUNS_LIMIT = 50;

interface IngestionRunRow {
  id: string;
  source_type: string;
  started_at: string;
  finished_at: string | null;
  items_fetched: number;
  items_queued: number;
  items_deduped: number;
  error: string | null;
}

function toIngestionRun(row: IngestionRunRow): IngestionRun {
  return {
    id: row.id,
    sourceType: row.source_type,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    itemsFetched: row.items_fetched,
    itemsQueued: row.items_queued,
    itemsDeduped: row.items_deduped,
    error: row.error,
  };
}

// ---------------------------------------------------------------------------
// GET /api/internal/ingestion-runs
//
// INGESTION_DESIGN.md §5: read-only observability page over the
// ingestion_runs table populated by migration 0019, "similar to Audit Log".
// requireAuth only (mounted the same way as every other internal route
// except reviewers.ts) -- no admin-only gate, any authenticated reviewer can
// see pipeline health.
// ---------------------------------------------------------------------------
ingestionRunsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<IngestionRunRow>(
      `SELECT id, source_type, started_at, finished_at, items_fetched, items_queued, items_deduped, error
         FROM ingestion_runs
        ORDER BY started_at DESC
        LIMIT $1`,
      [RECENT_RUNS_LIMIT],
    );

    const response: ListIngestionRunsResponse = { runs: result.rows.map(toIngestionRun) };
    res.status(200).json(response);
  }),
);
