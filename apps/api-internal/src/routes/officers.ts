import { Router } from "express";
import type {
  CreateOfficerRequest,
  CreateRecordResponse,
  EmploymentStatus,
  ListPendingPhotosResponse,
  OfficerDetail,
  OfficerSearchCandidate,
  PendingPhotoOfficer,
  SearchInternalOfficersResponse,
} from "@cop/shared-types";
import { STANDARD_OFFICER_PAGE_DISCLAIMER } from "@cop/shared-types";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";
import { writeRecordRevision } from "../revisions.js";
import { mapDepartmentRow, type DepartmentRow } from "../mappers.js";

export const officersRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "active",
  "inactive",
  "terminated",
  "resigned",
  "retired",
  "decertified",
];

// ---------------------------------------------------------------------------
// GET /api/internal/officers/search?q=&departmentId=
//
// Same matching behavior as apps/api-public's GET /api/public/officers/search
// (DESIGN.md §2/§6 disambiguation-only fields), reimplemented here rather
// than shared across services -- api-public and api-internal are separate
// services on purpose (DESIGN.md §8/§9), so this endpoint exists purely so
// the admin app's officer-picker doesn't need the public service reachable.
// ---------------------------------------------------------------------------
officersRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : undefined;

    if (!q) {
      throw new ApiError(400, "invalid_request", "Query parameter 'q' is required and must be non-empty.");
    }
    if (departmentId && !UUID_RE.test(departmentId)) {
      throw new ApiError(400, "invalid_request", "departmentId must be a valid UUID.");
    }

    const result = await pool.query<{
      id: string;
      first_name: string;
      last_name: string;
      department_id: string;
      department_name: string;
      badge_number: string | null;
      photo_url: string | null;
      hire_date: string | null;
      history_start: string | null;
      history_end: string | null;
    }>(
      `SELECT
         o.id, o.first_name, o.last_name, o.department_id, d.name AS department_name,
         o.badge_number, o.photo_url, o.hire_date,
         h.start_date AS history_start, h.end_date AS history_end
       FROM officers o
       JOIN departments d ON d.id = o.department_id
       LEFT JOIN LATERAL (
         SELECT start_date, end_date
         FROM officer_department_history
         WHERE officer_id = o.id AND department_id = o.department_id
         ORDER BY (end_date IS NULL) DESC, start_date DESC
         LIMIT 1
       ) h ON true
       WHERE
         (
           (o.first_name || ' ' || o.last_name) ILIKE '%' || $1 || '%'
           OR (o.first_name || ' ' || o.last_name) % $1
           OR o.badge_number ILIKE $1
         )
         AND ($2::uuid IS NULL OR o.department_id = $2)
       ORDER BY similarity(o.first_name || ' ' || o.last_name, $1) DESC, o.last_name ASC
       LIMIT 50`,
      [q, departmentId ?? null],
    );

    const candidates: OfficerSearchCandidate[] = result.rows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      departmentId: row.department_id,
      departmentName: row.department_name,
      badgeNumber: row.badge_number,
      activeDateRange: {
        start: row.history_start ?? row.hire_date ?? "",
        end: row.history_start ? row.history_end : null,
      },
      photoUrl: row.photo_url,
    }));

    const response: SearchInternalOfficersResponse = { candidates };
    res.status(200).json(response);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/internal/officers -- manual officer creation (DESIGN.md Phase 1 /
// §5's "every new source record either matches an existing officer or
// creates a candidate new officer entry" -- this is the reviewer-authored
// direct-entry path for the latter, bypassing review_queue since a reviewer
// is entering it themselves rather than an ingestion pipeline proposing it).
// ---------------------------------------------------------------------------
officersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateOfficerRequest>;
    const reviewer = req.reviewer!;

    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    if (!firstName || !lastName) {
      throw new ApiError(400, "invalid_request", "firstName and lastName are required.");
    }
    if (typeof body.departmentId !== "string" || !UUID_RE.test(body.departmentId)) {
      throw new ApiError(400, "invalid_request", "departmentId is required and must be a valid UUID.");
    }
    const employmentStatus: EmploymentStatus = body.employmentStatus ?? "active";
    if (!VALID_EMPLOYMENT_STATUSES.includes(employmentStatus)) {
      throw new ApiError(400, "invalid_request", `employmentStatus must be one of ${VALID_EMPLOYMENT_STATUSES.join(", ")}.`);
    }
    const knownAliases = Array.isArray(body.knownAliases) ? body.knownAliases.filter((a): a is string => typeof a === "string") : [];
    const badgeNumber = typeof body.badgeNumber === "string" ? body.badgeNumber : null;
    const rank = typeof body.rank === "string" ? body.rank : null;
    const hireDate = typeof body.hireDate === "string" ? body.hireDate : null;
    const postCertificationId = typeof body.postCertificationId === "string" ? body.postCertificationId : null;
    const photoUrl = typeof body.photoUrl === "string" ? body.photoUrl : null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const deptResult = await client.query<DepartmentRow>(
        `SELECT id, name, state, jurisdiction_type, contact_info, records_request_portal_url
           FROM departments WHERE id = $1`,
        [body.departmentId],
      );
      const departmentRow = deptResult.rows[0];
      if (!departmentRow) {
        throw new ApiError(400, "invalid_request", `No department found with id ${body.departmentId}.`);
      }

      const insertResult = await client.query<{
        id: string;
        first_name: string;
        last_name: string;
        known_aliases: string[];
        badge_number: string | null;
        rank: string | null;
        employment_status: EmploymentStatus;
        photo_url: string | null;
      }>(
        `INSERT INTO officers
           (first_name, last_name, known_aliases, department_id, badge_number, rank, hire_date, employment_status, post_certification_id, photo_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, first_name, last_name, known_aliases, badge_number, rank, employment_status, photo_url`,
        [firstName, lastName, knownAliases, body.departmentId, badgeNumber, rank, hireDate, employmentStatus, postCertificationId, photoUrl],
      );
      const o = insertResult.rows[0];

      const diff = {
        firstName,
        lastName,
        knownAliases,
        departmentId: body.departmentId,
        badgeNumber,
        rank,
        hireDate,
        employmentStatus,
        postCertificationId,
        photoUrl,
      };
      const revisionId = await writeRecordRevision(client, {
        recordType: "officer",
        recordId: o.id,
        changeType: "create",
        diff,
        changedBy: reviewer.id,
      });

      await client.query("COMMIT");

      const record: OfficerDetail = {
        id: o.id,
        firstName: o.first_name,
        lastName: o.last_name,
        knownAliases: o.known_aliases,
        department: mapDepartmentRow(departmentRow),
        badgeNumber: o.badge_number,
        rank: o.rank,
        employmentStatus: o.employment_status,
        photoUrl: o.photo_url,
        departmentHistory: [],
        incidents: [],
        resolvedDisputes: [],
        disclaimer: STANDARD_OFFICER_PAGE_DISCLAIMER,
      };

      const response: CreateRecordResponse<OfficerDetail> = { record, revisionId };
      res.status(201).json(response);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /api/internal/officers/pending-photos
//
// DESIGN.md §7's photo-confirmation gate ("photo_url is never auto-approved
// -- a reviewer must positively confirm the photo matches the officer").
// Lists every officer with a photo_url set but not yet confirmed, backing
// the admin app's photo-review queue. No admin gating -- any authenticated
// reviewer can act here, same as the rest of this router (only
// reviewers.ts's reviewer-management routes are admin-only).
// ---------------------------------------------------------------------------
officersRouter.get(
  "/pending-photos",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<{
      id: string;
      first_name: string;
      last_name: string;
      department_name: string;
      badge_number: string | null;
      photo_url: string;
      created_at: string;
    }>(
      `SELECT o.id, o.first_name, o.last_name, d.name AS department_name,
              o.badge_number, o.photo_url, o.created_at
         FROM officers o
         JOIN departments d ON d.id = o.department_id
        WHERE o.photo_url IS NOT NULL AND o.photo_confirmed = false
        ORDER BY o.created_at ASC`,
    );

    const officers: PendingPhotoOfficer[] = result.rows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      departmentName: row.department_name,
      badgeNumber: row.badge_number,
      photoUrl: row.photo_url,
      createdAt: row.created_at,
    }));

    const response: ListPendingPhotosResponse = { officers };
    res.status(200).json(response);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/internal/officers/:id/confirm-photo
// POST /api/internal/officers/:id/reject-photo
//
// The other half of DESIGN.md §7's photo-confirmation gate: a reviewer
// positively confirming (or rejecting) that photo_url actually depicts the
// officer being published. A rejected photo is removed outright, not left
// dangling in an unconfirmed state, so it can't accidentally resurface on
// the pending-photos queue under a stale URL if photo_url is ever set
// again by some future edit path.
//
// Both routes lock the officer row (SELECT ... FOR UPDATE) before checking
// eligibility, same defensive pattern as reviewQueue.ts's
// promoteReviewQueueItem, and write the record_revisions row in the same
// transaction as the officers UPDATE per revisions.ts's contract.
// ---------------------------------------------------------------------------
officersRouter.post(
  "/:id/confirm-photo",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const reviewer = req.reviewer!;
    if (!UUID_RE.test(id)) {
      throw new ApiError(400, "invalid_request", "officer id must be a valid UUID.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ id: string; photo_url: string | null; photo_confirmed: boolean }>(
        `SELECT id, photo_url, photo_confirmed FROM officers WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new ApiError(404, "not_found", `No officer with id ${id}.`);
      }
      if (!row.photo_url) {
        throw new ApiError(400, "no_photo", `Officer ${id} has no photo_url to confirm.`);
      }
      if (row.photo_confirmed) {
        throw new ApiError(400, "already_confirmed", `Officer ${id}'s photo is already confirmed.`);
      }

      const updateResult = await client.query<{
        id: string;
        photo_url: string;
        photo_confirmed: boolean;
        photo_confirmed_by: string;
        photo_confirmed_at: string;
      }>(
        `UPDATE officers
            SET photo_confirmed = true, photo_confirmed_by = $1, photo_confirmed_at = now()
          WHERE id = $2
          RETURNING id, photo_url, photo_confirmed, photo_confirmed_by, photo_confirmed_at`,
        [reviewer.id, id],
      );
      const updated = updateResult.rows[0];

      await writeRecordRevision(client, {
        recordType: "officer",
        recordId: id,
        changeType: "update",
        diff: { photoConfirmed: true },
        changedBy: reviewer.id,
      });

      await client.query("COMMIT");

      res.status(200).json({
        officer: {
          id: updated.id,
          photoUrl: updated.photo_url,
          photoConfirmed: updated.photo_confirmed,
          photoConfirmedBy: updated.photo_confirmed_by,
          photoConfirmedAt: updated.photo_confirmed_at,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

officersRouter.post(
  "/:id/reject-photo",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const reviewer = req.reviewer!;
    if (!UUID_RE.test(id)) {
      throw new ApiError(400, "invalid_request", "officer id must be a valid UUID.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ id: string; photo_url: string | null; photo_confirmed: boolean }>(
        `SELECT id, photo_url, photo_confirmed FROM officers WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new ApiError(404, "not_found", `No officer with id ${id}.`);
      }
      if (!row.photo_url) {
        throw new ApiError(400, "no_photo", `Officer ${id} has no photo_url to reject.`);
      }
      if (row.photo_confirmed) {
        throw new ApiError(
          400,
          "already_confirmed",
          `Officer ${id}'s photo is already confirmed -- nothing pending to reject.`,
        );
      }

      const updateResult = await client.query<{ id: string; photo_url: string | null; photo_confirmed: boolean }>(
        `UPDATE officers
            SET photo_url = NULL, photo_confirmed = false, photo_confirmed_by = NULL, photo_confirmed_at = NULL
          WHERE id = $1
          RETURNING id, photo_url, photo_confirmed`,
        [id],
      );
      const updated = updateResult.rows[0];

      await writeRecordRevision(client, {
        recordType: "officer",
        recordId: id,
        changeType: "update",
        diff: { photoUrl: null, photoRejected: true },
        changedBy: reviewer.id,
      });

      await client.query("COMMIT");

      res.status(200).json({
        officer: {
          id: updated.id,
          photoUrl: updated.photo_url,
          photoConfirmed: updated.photo_confirmed,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);
