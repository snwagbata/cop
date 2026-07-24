import { Router } from "express";
import type { CreatePublicTipRequest, CreatePublicTipResponse, IncidentCandidateProposal, IncidentType } from "@cop/shared-types";
import { pool } from "../db.js";
import { badRequest, sendError } from "../lib/errors.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

export const tipsRouter = Router();

const VALID_INCIDENT_TYPES: IncidentType[] = ["use_of_force", "false_report", "unlawful_arrest", "other"];

const NO_DEPARTMENT_PLACEHOLDER = "Unknown — reported via anonymous tip";

// See middleware/rateLimit.ts docstring: dev-only, in-memory, not
// production-hardened. Stricter than disputes' 5/10min because this surface
// has zero identity friction (no requesterName, nothing to hold anyone
// accountable to) — 3 submissions / 10 minutes / IP.
const tipRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 3 });

// Request body is untrusted network input, so every field is still validated
// at runtime below even though CreatePublicTipRequest marks most as
// required/typed — Partial<> here just documents "this is the shape we
// expect, not yet the shape we've verified." Same pattern as disputes.ts.
type CreateTipBody = Partial<CreatePublicTipRequest>;

// POST /api/public/tips
// DESIGN.md §12: anonymous, source-protected tip intake — no IP logging by
// default (the rate limiter above tracks req.ip in-memory for its own
// window only; nothing here persists or logs it), and deliberately no
// identifying information collected at all. Feeds the existing
// IncidentCandidateProposal review-queue pipeline (§5/§7) rather than a
// bespoke tip record type, with officerId left unset so a reviewer must
// search-and-match the real officer before approving (see
// apps/admin/src/components/ReviewQueueItemCard.tsx's needsOfficerId).
tipsRouter.post("/", tipRateLimit, async (req, res, next) => {
  try {
    const body = req.body as CreateTipBody;

    if (!body.description || typeof body.description !== "string" || !body.description.trim()) {
      throw badRequest("description is required.");
    }
    if (body.officerNameAsReported !== undefined && typeof body.officerNameAsReported !== "string") {
      throw badRequest("officerNameAsReported must be a string if provided.");
    }
    if (body.departmentNameAsReported !== undefined && typeof body.departmentNameAsReported !== "string") {
      throw badRequest("departmentNameAsReported must be a string if provided.");
    }
    if (body.incidentType !== undefined && !VALID_INCIDENT_TYPES.includes(body.incidentType as IncidentType)) {
      throw badRequest(`incidentType must be one of: ${VALID_INCIDENT_TYPES.join(", ")}.`);
    }
    if (body.incidentDateAsReported !== undefined && typeof body.incidentDateAsReported !== "string") {
      throw badRequest("incidentDateAsReported must be a string if provided.");
    }
    if (body.externalUrl !== undefined && typeof body.externalUrl !== "string") {
      throw badRequest("externalUrl must be a string if provided.");
    }

    const description = body.description.trim();
    const officerNameAsReported = body.officerNameAsReported?.trim() || undefined;
    const departmentNameAsReported = body.departmentNameAsReported?.trim() || undefined;
    const incidentType: IncidentType = body.incidentType ?? "other";
    const incidentDateAsReported = body.incidentDateAsReported?.trim() || undefined;
    const externalUrl = body.externalUrl?.trim() || undefined;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const sourceResult = await client.query<{ id: string }>(
        `INSERT INTO sources (source_type, url, reliability_tier)
         VALUES ('tip_submission', $1, 'tier4_submitted_unverified')
         RETURNING id`,
        [externalUrl ?? null]
      );
      const sourceId = sourceResult.rows[0].id;

      const proposal: IncidentCandidateProposal = {
        type: "incident_candidate",
        officerName: officerNameAsReported,
        departmentName: departmentNameAsReported ?? NO_DEPARTMENT_PLACEHOLDER,
        incidentType,
        shortDescription: description,
        date: incidentDateAsReported,
        note: "Submitted via the anonymous public tip form (DESIGN.md §12) — no requester identity was collected.",
        externalUrl,
      };

      await client.query(
        `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status)
         VALUES ($1, $2, 'low', 'pending')`,
        [JSON.stringify(proposal), sourceId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const responseBody: CreatePublicTipResponse = { success: true };
    res.status(201).json(responseBody);
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr && pgErr.code === "42501") {
      // Defensive: cop_public_api is granted INSERT on sources/review_queue
      // as of migration 0018, so this shouldn't fire in normal operation.
      // Kept as a specific branch (rather than falling through to
      // next(err)'s generic 500) so a future grant regression fails as a
      // clean, recognizable 500 instead of leaking a raw Postgres
      // permission error to the public response. Log full detail
      // server-side either way.
      // eslint-disable-next-line no-console
      console.error(
        "[tips] INSERT failed with permission denied — cop_public_api's grant on `sources`/`review_queue` may have regressed.",
        err
      );
      sendError(
        res,
        500,
        "server_misconfiguration",
        "Tip submission is temporarily unavailable. Please try again later."
      );
      return;
    }
    next(err);
  }
});
