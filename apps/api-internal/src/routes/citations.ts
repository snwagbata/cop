import { Router } from "express";
import type { CitableType, CreateCitationRequest } from "@cop/shared-types";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";

export const citationsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CITABLE_TYPES: CitableType[] = ["incident", "outcome", "officer"];

const CITABLE_TABLE: Record<CitableType, string> = {
  incident: "incidents",
  outcome: "outcomes",
  officer: "officers",
};

interface CitationRecord {
  id: string;
  sourceId: string;
  citableType: CitableType;
  citableId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// POST /api/internal/citations
//
// Direct insert, no CreateRecordResponse wrapper: citations aren't one of
// record_revisions.record_type's four values (officer / incident / outcome /
// source), so there's nothing to write a revision row for -- same reasoning
// the review_queue rejection path already applies (no revision for something
// that was never itself published as a fact). Response shape is ad hoc
// (`{ citation }`) since shared-types doesn't define a standalone Citation
// domain type -- citations are normally only ever surfaced embedded inside
// an Incident/Outcome's `citations: Source[]`.
// ---------------------------------------------------------------------------
citationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateCitationRequest>;

    if (typeof body.sourceId !== "string" || !UUID_RE.test(body.sourceId)) {
      throw new ApiError(400, "invalid_request", "sourceId is required and must be a valid UUID.");
    }
    if (!body.citableType || !VALID_CITABLE_TYPES.includes(body.citableType)) {
      throw new ApiError(400, "invalid_request", `citableType must be one of ${VALID_CITABLE_TYPES.join(", ")}.`);
    }
    if (typeof body.citableId !== "string" || !UUID_RE.test(body.citableId)) {
      throw new ApiError(400, "invalid_request", "citableId is required and must be a valid UUID.");
    }

    const sourceCheck = await pool.query<{ id: string }>(`SELECT id FROM sources WHERE id = $1`, [body.sourceId]);
    if (!sourceCheck.rows[0]) {
      throw new ApiError(400, "invalid_request", `No source found with id ${body.sourceId}.`);
    }

    // citable_id has no real FK (it's polymorphic -- DESIGN.md §4, migration
    // 0009), so we check existence at the application layer to avoid citing
    // a record that doesn't exist, same integrity stance taken everywhere
    // else in this build-out (resolveDepartmentId, officer/source lookups in
    // incidents.ts/outcomes.ts).
    const table = CITABLE_TABLE[body.citableType];
    const targetCheck = await pool.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = $1`, [body.citableId]);
    if (!targetCheck.rows[0]) {
      throw new ApiError(400, "invalid_request", `No ${body.citableType} found with id ${body.citableId}.`);
    }

    const insertResult = await pool.query<{ id: string; source_id: string; citable_type: CitableType; citable_id: string; created_at: string }>(
      `INSERT INTO citations (source_id, citable_type, citable_id)
       VALUES ($1, $2, $3)
       RETURNING id, source_id, citable_type, citable_id, created_at`,
      [body.sourceId, body.citableType, body.citableId],
    );
    const row = insertResult.rows[0];

    const citation: CitationRecord = {
      id: row.id,
      sourceId: row.source_id,
      citableType: row.citable_type,
      citableId: row.citable_id,
      createdAt: row.created_at,
    };
    res.status(201).json({ citation });
  }),
);
