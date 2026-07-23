import { Router } from "express";
import type {
  CreatePublicDisputeRequest,
  CreatePublicDisputeResponse,
  Dispute,
  DisputeRequesterRole,
  DisputeStatusResponse,
} from "@cop/shared-types";
import { pool } from "../db.js";
import { badRequest, notFound, sendError } from "../lib/errors.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

export const disputesRouter = Router();

const REQUESTER_ROLES: DisputeRequesterRole[] = ["officer", "department", "attorney", "subject", "other"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// See middleware/rateLimit.ts docstring: dev-only, in-memory, not
// production-hardened. 5 submissions / 10 minutes / IP.
const disputeRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

// Request body is untrusted network input, so every field is still validated
// at runtime below even though CreatePublicDisputeRequest marks most as
// required — Partial<> here just documents "this is the shape we expect,
// not yet the shape we've verified."
type CreateDisputeBody = Partial<CreatePublicDisputeRequest>;

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
    const dispute: Dispute = {
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
    };
    const responseBody: CreatePublicDisputeResponse = { dispute };
    res.status(201).json(responseBody);
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

// ---------------------------------------------------------------------------
// GET /api/public/disputes/:id
//
// Status-check for someone who submitted a dispute to look up what happened
// to it. Deliberately narrow response (DisputeStatusResponse: id/status/
// submittedAt/resolvedAt only) — this id is a UUID handed to the submitter
// at creation time, but the endpoint itself is public and unauthenticated,
// so it must never leak requesterName/claim/evidenceUrl/resolutionNotes to
// anyone else who has or guesses at the id.
// ---------------------------------------------------------------------------
disputesRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw badRequest("dispute id must be a valid UUID.");
    }

    const result = await pool.query<{
      id: string;
      status: DisputeStatusResponse["status"];
      submitted_at: string;
      resolved_at: string | null;
    }>(
      `SELECT id, status, submitted_at, resolved_at FROM disputes WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      throw notFound("Dispute");
    }

    const row = result.rows[0];
    const body: DisputeStatusResponse = {
      id: row.id,
      status: row.status,
      submittedAt: row.submitted_at,
      resolvedAt: row.resolved_at,
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
