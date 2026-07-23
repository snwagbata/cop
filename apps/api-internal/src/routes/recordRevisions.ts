import { Router } from "express";
import type { ListRecordRevisionsResponse, RecordRevision } from "@cop/shared-types";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";

export const recordRevisionsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RECORD_TYPES: RecordRevision["recordType"][] = ["officer", "incident", "outcome", "source"];

interface RecordRevisionRow {
  id: string;
  record_type: RecordRevision["recordType"];
  record_id: string;
  change_type: RecordRevision["changeType"];
  diff: Record<string, unknown> | null;
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: string;
}

function toRecordRevision(row: RecordRevisionRow): RecordRevision {
  return {
    id: row.id,
    recordType: row.record_type,
    recordId: row.record_id,
    changeType: row.change_type,
    diff: row.diff,
    changedByReviewerId: row.changed_by,
    // changed_by is nullable on the table (ON DELETE behavior aside, no
    // reviewer row is ever hard-deleted, but the column itself allows NULL --
    // migration 0011) and reviewers.name could theoretically be missing if
    // the LEFT JOIN doesn't find a match, so this stays nullable end to end
    // rather than assuming every historical row has a resolvable reviewer.
    changedByReviewerName: row.changed_by_name,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// GET /api/internal/record-revisions?recordType=&recordId=&page=&pageSize=
// ---------------------------------------------------------------------------
recordRevisionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const recordType = typeof req.query.recordType === "string" ? req.query.recordType : undefined;
    if (recordType && !VALID_RECORD_TYPES.includes(recordType as RecordRevision["recordType"])) {
      throw new ApiError(400, "invalid_request", `recordType must be one of ${VALID_RECORD_TYPES.join(", ")}.`);
    }
    const recordId = typeof req.query.recordId === "string" ? req.query.recordId : undefined;
    if (recordId && !UUID_RE.test(recordId)) {
      throw new ApiError(400, "invalid_request", "recordId must be a valid UUID.");
    }

    const pageRaw = typeof req.query.page === "string" ? Number.parseInt(req.query.page, 10) : NaN;
    const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    const pageSizeRaw = typeof req.query.pageSize === "string" ? Number.parseInt(req.query.pageSize, 10) : NaN;
    const pageSize = Number.isInteger(pageSizeRaw) && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 25;
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (recordType) {
      params.push(recordType);
      conditions.push(`rr.record_type = $${params.length}`);
    }
    if (recordId) {
      params.push(recordId);
      conditions.push(`rr.record_id = $${params.length}`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query<{ count: string }>(
      `SELECT count(*) FROM record_revisions rr ${whereClause}`,
      params,
    );

    params.push(pageSize);
    params.push(offset);
    const rowsResult = await pool.query<RecordRevisionRow>(
      `SELECT rr.id, rr.record_type, rr.record_id, rr.change_type, rr.diff, rr.changed_by,
              r.name AS changed_by_name, rr.created_at
         FROM record_revisions rr
         LEFT JOIN reviewers r ON r.id = rr.changed_by
         ${whereClause}
        ORDER BY rr.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const response: ListRecordRevisionsResponse = {
      revisions: rowsResult.rows.map(toRecordRevision),
      pageInfo: { page, pageSize, totalCount: Number(countResult.rows[0].count) },
    };
    res.status(200).json(response);
  }),
);
