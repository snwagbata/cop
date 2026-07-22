import { Router } from "express";
import type { DisputeRequesterRole } from "@cop/shared-types";
import { pool } from "../db.js";
import { badRequest, sendError } from "../lib/errors.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

export const disputesRouter = Router();

const REQUESTER_ROLES: DisputeRequesterRole[] = ["officer", "department", "attorney", "subject", "other"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// See middleware/rateLimit.ts docstring: dev-only, in-memory, not
// production-hardened. 5 submissions / 10 minutes / IP.
const disputeRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

interface CreateDisputeBody {
  incidentId?: string;
  outcomeId?: string;
  officerId?: string;
  requesterName?: string;
  requesterRole?: string;
  claim?: string;
  evidenceUrl?: string;
}

// POST /api/public/disputes
// DESIGN.md §10: the public correction/takedown submission form. Validates
// the "exactly one target" rule itself (clean 400) ahead of the DB's own
// CHECK constraint doing the same thing, and does NOT attempt to flip
// incidents.status to 'disputed' on creation — see task note: the schema
// doesn't store a prior status to revert to, so a half-implemented status
// flip would be worse than leaving that to a reviewer.
disputesRouter.post("/", disputeRateLimit, async (req, res, next) => {
  try {
    const body = req.body as CreateDisputeBody;

    const targets = [body.incidentId, body.outcomeId, body.officerId].filter(
      (v) => v !== undefined && v !== null && v !== ""
    );
    if (targets.length !== 1) {
      throw badRequest(
        "Exactly one of incidentId, outcomeId, or officerId must be set."
      );
    }
    for (const [field, value] of [
      ["incidentId", body.incidentId],
      ["outcomeId", body.outcomeId],
      ["officerId", body.officerId],
    ] as const) {
      if (value !== undefined && !UUID_RE.test(value)) {
        throw badRequest(`${field} must be a valid UUID.`);
      }
    }

    if (!body.requesterName || typeof body.requesterName !== "string" || !body.requesterName.trim()) {
      throw badRequest("requesterName is required.");
    }
    if (!body.requesterRole || !REQUESTER_ROLES.includes(body.requesterRole as DisputeRequesterRole)) {
      throw badRequest(`requesterRole must be one of: ${REQUESTER_ROLES.join(", ")}.`);
    }
    if (!body.claim || typeof body.claim !== "string" || !body.claim.trim()) {
      throw badRequest("claim is required.");
    }
    if (body.evidenceUrl !== undefined && typeof body.evidenceUrl !== "string") {
      throw badRequest("evidenceUrl must be a string if provided.");
    }

    const result = await pool.query<{
      id: string;
      incident_id: string | null;
      outcome_id: string | null;
      officer_id: string | null;
      requester_name: string;
      requester_role: DisputeRequesterRole;
      claim: string;
      evidence_url: string | null;
      submitted_at: string;
      status: "open";
    }>(
      `INSERT INTO disputes
         (incident_id, outcome_id, officer_id, requester_name, requester_role, claim, evidence_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
       RETURNING id, incident_id, outcome_id, officer_id, requester_name, requester_role,
                 claim, evidence_url, submitted_at, status`,
      [
        body.incidentId ?? null,
        body.outcomeId ?? null,
        body.officerId ?? null,
        body.requesterName.trim(),
        body.requesterRole,
        body.claim.trim(),
        body.evidenceUrl ?? null,
      ]
    );

    const row = result.rows[0];
    res.status(201).json({
      dispute: {
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
        resolutionNotes: null,
        resolvedBy: null,
        resolvedAt: null,
      },
    });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr && pgErr.code === "42501") {
      // permission denied — the cop_public_api role lacks a grant it needs
      // for this endpoint. See apps/api-public/README.md "Known issue" and
      // the task verification report: migration 0015 does not currently
      // grant INSERT (or even SELECT) on `disputes` to cop_public_api,
      // despite DESIGN.md §10 describing public dispute submission as this
      // service's one write path. Log full detail server-side; don't leak
      // DB role/grant internals to the public response.
      // eslint-disable-next-line no-console
      console.error(
        "[disputes] INSERT failed with permission denied — cop_public_api likely lacks a grant on `disputes`.",
        err
      );
      sendError(
        res,
        500,
        "server_misconfiguration",
        "Dispute submission is temporarily unavailable. Please try again later or use the published correction contact."
      );
      return;
    }
    next(err);
  }
});
