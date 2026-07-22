import { Router } from "express";
import type {
  ApproveReviewQueueItemRequest,
  EmploymentStatus,
  IncidentCandidateProposal,
  IncidentType,
  ListReviewQueueResponse,
  MatchConfidence,
  OfficerCandidateProposal,
  RejectReviewQueueItemRequest,
  ReviewQueueItem,
  ReviewQueueProposal,
  ReviewQueueStatus,
  Source,
} from "@cop/shared-types";
import { pool, query } from "../db.js";
import { ApiError, sendError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";

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
        url: row.src_url as string,
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

type Queryable = { query: <T = any>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> };

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

      // Lock review_queue directly (not the LEFT JOIN view -- Postgres
      // rejects FOR UPDATE on the nullable side of an outer join) then
      // pull the full joined row separately.
      const lockResult = await client.query<{ id: string; proposed_record: ReviewQueueProposal; status: ReviewQueueStatus }>(
        `SELECT id, proposed_record, status FROM review_queue WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const existing = lockResult.rows[0];
      if (!existing) {
        await client.query("ROLLBACK");
        sendError(res, 404, "not_found", `No review_queue item with id ${id}.`);
        return;
      }
      if (existing.status !== "pending" && existing.status !== "needs_more_info") {
        await client.query("ROLLBACK");
        sendError(
          res,
          400,
          "already_reviewed",
          `review_queue item ${id} has status "${existing.status}" and cannot be approved again.`,
        );
        return;
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
        await client.query(
          `INSERT INTO record_revisions (record_type, record_id, change_type, diff, changed_by)
           VALUES ('officer', $1, 'create', $2, $3)`,
          [officerId, JSON.stringify(diff), reviewer.id],
        );
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
        await client.query(
          `INSERT INTO record_revisions (record_type, record_id, change_type, diff, changed_by)
           VALUES ('incident', $1, 'create', $2, $3)`,
          [incidentId, JSON.stringify(diff), reviewer.id],
        );
      } else {
        throw new ApiError(400, "invalid_proposal_type", `Unrecognized proposed_record.type "${(proposed as { type?: string }).type}".`);
      }

      await client.query(
        `UPDATE review_queue SET status = 'approved', reviewer_id = $1, reviewed_at = now() WHERE id = $2`,
        [reviewer.id, id],
      );

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
