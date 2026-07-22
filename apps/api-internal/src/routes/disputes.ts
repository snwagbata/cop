import { Router } from "express";
import type { Dispute, DisputeStatus, ListDisputesResponse, ResolveDisputeRequest } from "@cop/shared-types";
import { query } from "../db.js";
import { sendError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";

export const disputesRouter = Router();

interface DisputeRow {
  [key: string]: unknown;
  id: string;
  incident_id: string | null;
  outcome_id: string | null;
  officer_id: string | null;
  requester_name: string;
  requester_role: Dispute["requesterRole"];
  claim: string;
  evidence_url: string | null;
  submitted_at: string;
  status: DisputeStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

function toDispute(row: DisputeRow): Dispute {
  return {
    id: row.id,
    incidentId: row.incident_id,
    outcomeId: row.outcome_id,
    officerId: row.officer_id,
    requesterName: row.requester_name,
    requesterRole: row.requester_role,
    claim: row.claim,
    evidenceUrl: row.evidence_url,
    submittedAt: row.submitted_at,
    status: row.status,
    resolutionNotes: row.resolution_notes,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
  };
}

const VALID_STATUSES: DisputeStatus[] = ["open", "resolved_corrected", "resolved_no_change", "resolved_removed"];
const RESOLVABLE_STATUSES: Exclude<DisputeStatus, "open">[] = [
  "resolved_corrected",
  "resolved_no_change",
  "resolved_removed",
];

disputesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !VALID_STATUSES.includes(status as DisputeStatus)) {
      sendError(res, 400, "invalid_request", `status must be one of ${VALID_STATUSES.join(", ")}.`);
      return;
    }

    const result = status
      ? await query<DisputeRow>(`SELECT * FROM disputes WHERE status = $1 ORDER BY submitted_at DESC`, [status])
      : await query<DisputeRow>(`SELECT * FROM disputes ORDER BY submitted_at DESC`);

    const response: ListDisputesResponse = { disputes: result.rows.map(toDispute) };
    res.status(200).json(response);
  }),
);

disputesRouter.post(
  "/:id/resolve",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body as Partial<ResolveDisputeRequest>;
    const reviewer = req.reviewer!;

    if (!body.status || !RESOLVABLE_STATUSES.includes(body.status as Exclude<DisputeStatus, "open">)) {
      sendError(res, 400, "invalid_request", `status must be one of ${RESOLVABLE_STATUSES.join(", ")}.`);
      return;
    }
    const resolutionNotes = typeof body.resolutionNotes === "string" ? body.resolutionNotes.trim() : "";
    if (!resolutionNotes) {
      sendError(res, 400, "invalid_request", "resolutionNotes is required.");
      return;
    }

    const existing = await query<DisputeRow>(`SELECT * FROM disputes WHERE id = $1`, [id]);
    const row = existing.rows[0];
    if (!row) {
      sendError(res, 404, "not_found", `No dispute with id ${id}.`);
      return;
    }
    if (row.status !== "open") {
      sendError(res, 400, "already_resolved", `Dispute ${id} already has status "${row.status}".`);
      return;
    }

    // Per the task spec: resolve the dispute record only. We deliberately do
    // not touch the target incident's `status` field here -- doing that
    // correctly would need a prior-status field the schema doesn't have yet.
    const updateResult = await query<DisputeRow>(
      `UPDATE disputes
          SET status = $1, resolution_notes = $2, resolved_by = $3, resolved_at = now()
        WHERE id = $4
        RETURNING *`,
      [body.status, resolutionNotes, reviewer.id, id],
    );

    res.status(200).json({ dispute: toDispute(updateResult.rows[0]) });
  }),
);
