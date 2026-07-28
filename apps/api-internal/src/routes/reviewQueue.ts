import { Router } from "express";
import type {
  ApproveReviewQueueItemRequest,
  BulkApproveRequest,
  BulkApproveResponse,
  EmploymentStatus,
  GetReviewDigestResponse,
  IncidentCandidateProposal,
  IncidentType,
  ListReviewQueueResponse,
  MatchConfidence,
  OfficerCandidateProposal,
  RejectReviewQueueItemRequest,
  ReviewDigest,
  ReviewQueueItem,
  ReviewQueueProposal,
  ReviewQueueStatus,
  Source,
} from "@cop/shared-types";
import { pool, query, type Queryable } from "../db.js";
import { ApiError, sendError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";
import { writeRecordRevision } from "../revisions.js";

export const reviewQueueRouter = Router();

interface ReviewQueueRow {
  [key: string]: unknown;
  id: string;
  proposed_record: ReviewQueueProposal;
  match_confidence: MatchConfidence;
  status: ReviewQueueStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  source_id: string | null;
  src_id: string | null;
  src_source_type: string | null;
  src_url: string | null;
  src_publication_date: string | null;
  src_retrieved_date: string | null;
  src_reliability_tier: string | null;
}

const REVIEW_QUEUE_SELECT = `
  SELECT
    rq.id, rq.proposed_record, rq.match_confidence, rq.status,
    rq.reviewer_id, rq.reviewed_at, rq.created_at, rq.source_id,
    s.id AS src_id, s.source_type AS src_source_type, s.url AS src_url,
    s.publication_date AS src_publication_date,
    s.retrieved_date AS src_retrieved_date,
    s.reliability_tier AS src_reliability_tier
  FROM review_queue rq
  LEFT JOIN sources s ON s.id = rq.source_id
`;

function toReviewQueueItem(row: ReviewQueueRow): ReviewQueueItem {
  const source: Source | null = row.src_id
    ? {
        id: row.src_id,
        sourceType: row.src_source_type as Source["sourceType"],
        url: row.src_url,
        publicationDate: row.src_publication_date,
        retrievedDate: row.src_retrieved_date as string,
        reliabilityTier: row.src_reliability_tier as Source["reliabilityTier"],
      }
    : null;

  return {
    id: row.id,
    proposedRecord: row.proposed_record,
    source,
    matchConfidence: row.match_confidence,
    status: row.status,
    reviewerId: row.reviewer_id,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

async function fetchReviewQueueItem(client: Queryable, id: string): Promise<ReviewQueueItem | null> {
  const result = await client.query<ReviewQueueRow>(`${REVIEW_QUEUE_SELECT} WHERE rq.id = $1`, [id]);
  const row = result.rows[0];
  return row ? toReviewQueueItem(row) : null;
}

reviewQueueRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const validStatuses: ReviewQueueStatus[] = ["pending", "approved", "rejected", "needs_more_info"];
    if (status && !validStatuses.includes(status as ReviewQueueStatus)) {
      sendError(res, 400, "invalid_request", `status must be one of ${validStatuses.join(", ")}.`);
      return;
    }

    const result = status
      ? await query<ReviewQueueRow>(`${REVIEW_QUEUE_SELECT} WHERE rq.status = $1 ORDER BY rq.created_at DESC`, [
          status,
        ])
      : await query<ReviewQueueRow>(`${REVIEW_QUEUE_SELECT} ORDER BY rq.created_at DESC`);

    const response: ListReviewQueueResponse = { items: result.rows.map(toReviewQueueItem) };
    res.status(200).json(response);
  }),
);

/** Case-insensitive department name -> id lookup. Never guesses on no match (DESIGN.md §6). */
async function resolveDepartmentId(client: Queryable, departmentName: unknown): Promise<string> {
  if (typeof departmentName !== "string" || !departmentName.trim()) {
    throw new ApiError(400, "invalid_request", "departmentName is required to resolve a department.");
  }
  const result = await client.query<{ id: string }>(`SELECT id FROM departments WHERE lower(name) = lower($1)`, [
    departmentName.trim(),
  ]);
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      400,
      "no_department_match",
      `No department found matching name "${departmentName}". Refusing to guess -- resolve manually and retry with edits.departmentName set to an exact match.`,
    );
  }
  return row.id;
}

const VALID_EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "active",
  "inactive",
  "terminated",
  "resigned",
  "retired",
  "decertified",
];

const VALID_INCIDENT_TYPES: IncidentType[] = ["use_of_force", "false_report", "unlawful_arrest", "other"];

/**
 * Locks and promotes one pending/needs_more_info review_queue item into the
 * public schema, writing the matching record_revisions row in the same
 * transaction. Shared by both POST /:id/approve and POST /bulk-approve so
 * the two entry points can't drift on validation/promotion behavior.
 *
 * Caller owns the transaction (BEGIN/COMMIT/ROLLBACK) and must pass a
 * checked-out PoolClient, not the bare pool -- this function issues multiple
 * statements that must land atomically together.
 *
 * Lock note: locks review_queue directly (`SELECT ... FOR UPDATE`), not the
 * REVIEW_QUEUE_SELECT LEFT JOIN view -- Postgres rejects FOR UPDATE on the
 * nullable side of an outer join (the real bug this codebase hit during MVP
 * verification), so the full joined row is only ever read separately, after
 * the plain-table lock succeeds.
 */
async function promoteReviewQueueItem(
  client: Queryable,
  id: string,
  reviewerId: string,
  edits: Record<string, unknown>,
): Promise<void> {
  const lockResult = await client.query<{ id: string; proposed_record: ReviewQueueProposal; status: ReviewQueueStatus }>(
    `SELECT id, proposed_record, status FROM review_queue WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const existing = lockResult.rows[0];
  if (!existing) {
    throw new ApiError(404, "not_found", `No review_queue item with id ${id}.`);
  }
  if (existing.status !== "pending" && existing.status !== "needs_more_info") {
    throw new ApiError(
      400,
      "already_reviewed",
      `review_queue item ${id} has status "${existing.status}" and cannot be approved again.`,
    );
  }

  const proposed = existing.proposed_record as ReviewQueueProposal;
  // Field-level edits are applied on top of the proposed record before
  // promotion, per ApproveReviewQueueItemRequest.edits.
  const effective: Record<string, unknown> = { ...proposed, ...edits };

  if (proposed.type === "officer_candidate") {
    const officerProposal = proposed as OfficerCandidateProposal;
    const departmentId = await resolveDepartmentId(client, effective.departmentName);

    const firstName = (effective.firstName as string) ?? officerProposal.firstName;
    const lastName = (effective.lastName as string) ?? officerProposal.lastName;
    if (!firstName || !lastName) {
      throw new ApiError(400, "invalid_request", "firstName and lastName are required.");
    }
    const badgeNumber = (effective.badgeNumber as string | undefined) ?? null;
    const postCertificationId = (effective.postCertificationId as string | undefined) ?? null;

    const employmentStatus = ((edits.employmentStatus as EmploymentStatus | undefined) ?? "active") as
      | EmploymentStatus
      | string;
    if (!VALID_EMPLOYMENT_STATUSES.includes(employmentStatus as EmploymentStatus)) {
      throw new ApiError(
        400,
        "invalid_request",
        `edits.employmentStatus must be one of ${VALID_EMPLOYMENT_STATUSES.join(", ")}.`,
      );
    }

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO officers
         (first_name, last_name, department_id, badge_number, employment_status, post_certification_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [firstName, lastName, departmentId, badgeNumber, employmentStatus, postCertificationId],
    );
    const officerId = insertResult.rows[0].id;

    const diff = {
      firstName,
      lastName,
      departmentId,
      badgeNumber,
      employmentStatus,
      postCertificationId,
    };
    await writeRecordRevision(client, {
      recordType: "officer",
      recordId: officerId,
      changeType: "create",
      diff,
      changedBy: reviewerId,
    });
  } else if (proposed.type === "incident_candidate") {
    const officerId = (proposed as IncidentCandidateProposal).officerId ?? (edits.officerId as string | undefined);
    if (!officerId) {
      throw new ApiError(
        400,
        "officer_not_resolved",
        "Cannot approve an incident_candidate without a resolved officer -- set proposedRecord.officerId " +
          "or pass edits.officerId. Per DESIGN.md §6, ambiguous officer matches are never auto-resolved.",
      );
    }

    const officerCheck = await client.query<{ id: string }>(`SELECT id FROM officers WHERE id = $1`, [
      officerId,
    ]);
    if (!officerCheck.rows[0]) {
      throw new ApiError(400, "invalid_request", `No officer found with id ${officerId}.`);
    }

    const departmentId = await resolveDepartmentId(client, effective.departmentName);

    const incidentType = effective.incidentType as string | undefined;
    if (!incidentType || !VALID_INCIDENT_TYPES.includes(incidentType as IncidentType)) {
      throw new ApiError(400, "invalid_request", `incidentType must be one of ${VALID_INCIDENT_TYPES.join(", ")}.`);
    }
    const shortDescription = effective.shortDescription as string | undefined;
    if (!shortDescription || !shortDescription.trim()) {
      throw new ApiError(400, "invalid_request", "shortDescription is required.");
    }
    const date = effective.date as string | undefined;
    if (!date) {
      throw new ApiError(400, "invalid_request", "date is required.");
    }

    const incidentResult = await client.query<{ id: string }>(
      `INSERT INTO incidents (department_id, date, incident_type, short_description)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [departmentId, date, incidentType, shortDescription],
    );
    const incidentId = incidentResult.rows[0].id;

    await client.query(
      `INSERT INTO incident_officers (incident_id, officer_id, involvement_role)
       VALUES ($1, $2, 'primary')`,
      [incidentId, officerId],
    );

    const diff = { departmentId, date, incidentType, shortDescription, officerId };
    await writeRecordRevision(client, {
      recordType: "incident",
      recordId: incidentId,
      changeType: "create",
      diff,
      changedBy: reviewerId,
    });

    const proposedOutcome = (proposed as IncidentCandidateProposal).proposedOutcome;
    if (proposedOutcome) {
      const outcomeResult = await client.query<{ id: string }>(
        `INSERT INTO outcomes (incident_id, outcome_type, date, details)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [incidentId, proposedOutcome.outcomeType, proposedOutcome.date ?? null, proposedOutcome.details ?? null],
      );
      const outcomeDiff = {
        incidentId,
        outcomeType: proposedOutcome.outcomeType,
        date: proposedOutcome.date ?? null,
        details: proposedOutcome.details ?? null,
      };
      await writeRecordRevision(client, {
        recordType: "outcome",
        recordId: outcomeResult.rows[0].id,
        changeType: "create",
        diff: outcomeDiff,
        changedBy: reviewerId,
      });
    }
  } else {
    throw new ApiError(400, "invalid_proposal_type", `Unrecognized proposed_record.type "${(proposed as { type?: string }).type}".`);
  }

  await client.query(
    `UPDATE review_queue SET status = 'approved', reviewer_id = $1, reviewed_at = now() WHERE id = $2`,
    [reviewerId, id],
  );
}

reviewQueueRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = (req.body ?? {}) as ApproveReviewQueueItemRequest;
    const edits = (body.edits ?? {}) as Record<string, unknown>;
    const reviewer = req.reviewer!;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await promoteReviewQueueItem(client, id, reviewer.id, edits);
      await client.query("COMMIT");

      const updated = await fetchReviewQueueItem(pool, id);
      res.status(200).json({ item: updated });
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof ApiError) {
        sendError(res, err.status, err.code, err.message);
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  }),
);

reviewQueueRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body as Partial<RejectReviewQueueItemRequest>;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const reviewer = req.reviewer!;

    if (!reason) {
      sendError(res, 400, "invalid_request", "reason is required.");
      return;
    }

    const existing = await query<ReviewQueueRow>(`${REVIEW_QUEUE_SELECT} WHERE rq.id = $1`, [id]);
    const row = existing.rows[0];
    if (!row) {
      sendError(res, 404, "not_found", `No review_queue item with id ${id}.`);
      return;
    }
    if (row.status !== "pending" && row.status !== "needs_more_info") {
      sendError(res, 400, "already_reviewed", `review_queue item ${id} has status "${row.status}" and cannot be rejected again.`);
      return;
    }

    // No dedicated rejection-reason column on review_queue (migration 0010),
    // and per the task spec no record_revisions row is written for a
    // rejection (nothing was actually published). We stash the reason back
    // onto proposed_record itself, under `rejectionReason`, so it stays
    // queryable without a schema change.
    const proposedWithReason = { ...row.proposed_record, rejectionReason: reason };

    await query(
      `UPDATE review_queue
          SET status = 'rejected', reviewer_id = $1, reviewed_at = now(), proposed_record = $2
        WHERE id = $3`,
      [reviewer.id, JSON.stringify(proposedWithReason), id],
    );

    const updated = await fetchReviewQueueItem(pool, id);
    res.status(200).json({ item: updated });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/internal/review-queue/digest?days=<default 7>
//
// DESIGN.md §7's weekly-digest feature ("12 new candidate records this week,
// 9 auto-matched with high confidence, 3 need your input"). highConfidence-
// Count and needsAttentionCount are both subsets of newCount (i.e. of the
// records *created* in the window) -- that's the reading that makes
// DESIGN.md's own example arithmetic work (9 + 3 = 12), not an independent,
// window-scoped count of the whole backlog. approvedCount/rejectedCount use
// reviewed_at for their window filter instead (a record approved this week
// may have been created long before it). openDisputeCount is a current
// backlog snapshot, not scoped to the window at all.
// ---------------------------------------------------------------------------
reviewQueueRouter.get(
  "/digest",
  asyncHandler(async (req, res) => {
    const daysRaw = typeof req.query.days === "string" ? Number.parseInt(req.query.days, 10) : NaN;
    const days = Number.isInteger(daysRaw) && daysRaw >= 1 ? daysRaw : 7;

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);
    const periodStartIso = periodStart.toISOString();
    const periodEndIso = periodEnd.toISOString();

    const [newRes, highRes, attnRes, apprRes, rejRes, disputeRes] = await Promise.all([
      query<{ count: string }>(
        `SELECT count(*) FROM review_queue WHERE created_at >= $1 AND created_at <= $2`,
        [periodStartIso, periodEndIso],
      ),
      query<{ count: string }>(
        `SELECT count(*) FROM review_queue WHERE created_at >= $1 AND created_at <= $2 AND match_confidence = 'high'`,
        [periodStartIso, periodEndIso],
      ),
      query<{ count: string }>(
        `SELECT count(*) FROM review_queue
          WHERE created_at >= $1 AND created_at <= $2
            AND status = 'pending' AND match_confidence IN ('medium', 'low')`,
        [periodStartIso, periodEndIso],
      ),
      query<{ count: string }>(
        `SELECT count(*) FROM review_queue WHERE status = 'approved' AND reviewed_at >= $1 AND reviewed_at <= $2`,
        [periodStartIso, periodEndIso],
      ),
      query<{ count: string }>(
        `SELECT count(*) FROM review_queue WHERE status = 'rejected' AND reviewed_at >= $1 AND reviewed_at <= $2`,
        [periodStartIso, periodEndIso],
      ),
      query<{ count: string }>(`SELECT count(*) FROM disputes WHERE status = 'open'`),
    ]);

    const digest: ReviewDigest = {
      periodStart: periodStartIso,
      periodEnd: periodEndIso,
      newCount: Number(newRes.rows[0].count),
      highConfidenceCount: Number(highRes.rows[0].count),
      needsAttentionCount: Number(attnRes.rows[0].count),
      approvedCount: Number(apprRes.rows[0].count),
      rejectedCount: Number(rejRes.rows[0].count),
      openDisputeCount: Number(disputeRes.rows[0].count),
    };

    const response: GetReviewDigestResponse = { digest };
    res.status(200).json(response);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/internal/review-queue/bulk-approve
//
// DESIGN.md §7's "bulk-approve a whole batch from a single trusted source
// after spot-checking a sample." Enforces the tier1/tier2-source +
// high-match-confidence gate that one-click approval requires (§4, §7) --
// the pre-existing single-item /:id/approve route doesn't itself gate on
// reliability_tier/match_confidence, so there's no existing check to
// literally copy; this implements DESIGN.md's stated rule directly rather
// than inventing a different one, and BulkApproveRequest's shared-types doc
// comment specifies this exact rule for this exact endpoint. Each id is
// checked and promoted in its own transaction so one failure can't roll
// back another id's success.
// ---------------------------------------------------------------------------
const BULK_APPROVE_ELIGIBLE_TIERS = new Set(["tier1_primary_legal_doc", "tier2_official_dataset"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

reviewQueueRouter.post(
  "/bulk-approve",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<BulkApproveRequest>;
    const reviewer = req.reviewer!;
    const reviewQueueIds = Array.isArray(body.reviewQueueIds)
      ? body.reviewQueueIds.filter((id): id is string => typeof id === "string")
      : [];

    if (reviewQueueIds.length === 0) {
      sendError(res, 400, "invalid_request", "reviewQueueIds is required and must be a non-empty array.");
      return;
    }

    const approved: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of reviewQueueIds) {
      if (!UUID_RE.test(id)) {
        failed.push({ id, error: "id must be a valid UUID." });
        continue;
      }

      // Eligibility check (DESIGN.md §4/§7: tier1/tier2 source + high match
      // confidence only) happens up front, outside any transaction -- these
      // fields are never mutated by anything else in this API once a
      // review_queue row is created, so there's no meaningful race to guard
      // against by folding this into promoteReviewQueueItem's own lock.
      const eligibility = await query<{
        status: ReviewQueueStatus;
        match_confidence: MatchConfidence;
        reliability_tier: string | null;
      }>(
        `SELECT rq.status, rq.match_confidence, s.reliability_tier
           FROM review_queue rq
           LEFT JOIN sources s ON s.id = rq.source_id
          WHERE rq.id = $1`,
        [id],
      );
      const row = eligibility.rows[0];
      if (!row) {
        failed.push({ id, error: `No review_queue item with id ${id}.` });
        continue;
      }
      if (row.status !== "pending" && row.status !== "needs_more_info") {
        failed.push({ id, error: `Item has status "${row.status}" and cannot be approved again.` });
        continue;
      }
      if (row.match_confidence !== "high") {
        failed.push({
          id,
          error: `Bulk approval requires match_confidence "high" (got "${row.match_confidence}").`,
        });
        continue;
      }
      if (!row.reliability_tier || !BULK_APPROVE_ELIGIBLE_TIERS.has(row.reliability_tier)) {
        failed.push({
          id,
          error: `Bulk approval requires a tier1/tier2 source (got "${row.reliability_tier ?? "none"}").`,
        });
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await promoteReviewQueueItem(client, id, reviewer.id, {});
        await client.query("COMMIT");
        approved.push(id);
      } catch (err) {
        await client.query("ROLLBACK");
        failed.push({ id, error: err instanceof ApiError ? err.message : "Unexpected error while promoting this item." });
      } finally {
        client.release();
      }
    }

    const response: BulkApproveResponse = { approved, failed };
    res.status(200).json(response);
  }),
);
