import { Router } from "express";
import bcrypt from "bcryptjs";
import type { CreateReviewerRequest, ListReviewersResponse, Reviewer, UpdateReviewerRequest } from "@cop/shared-types";
import { pool } from "../db.js";
import { ApiError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";

export const reviewersRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROLES: Reviewer["role"][] = ["admin", "reviewer"];

interface ReviewerRow {
  id: string;
  name: string;
  email: string;
  role: Reviewer["role"];
  active: boolean;
}

function toReviewer(row: ReviewerRow): Reviewer {
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active };
}

// Reviewer management is admin-only (task spec). requireAuth (mounted ahead
// of this router in index.ts) has already populated req.reviewer; this just
// adds the role check on top, same 403-on-mismatch convention as the rest of
// the API's error handling.
reviewersRouter.use((req, _res, next) => {
  if (req.reviewer?.role !== "admin") {
    next(new ApiError(403, "forbidden", "Admin role required."));
    return;
  }
  next();
});

reviewersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<ReviewerRow>(
      `SELECT id, name, email, role, active FROM reviewers ORDER BY name ASC`,
    );
    const response: ListReviewersResponse = { reviewers: result.rows.map(toReviewer) };
    res.status(200).json(response);
  }),
);

reviewersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateReviewerRequest>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!name || !email) {
      throw new ApiError(400, "invalid_request", "name and email are required.");
    }
    if (!body.role || !VALID_ROLES.includes(body.role)) {
      throw new ApiError(400, "invalid_request", `role must be one of ${VALID_ROLES.join(", ")}.`);
    }
    if (password.length < 8) {
      throw new ApiError(400, "invalid_request", "password must be at least 8 characters.");
    }

    // Same bcryptjs hashing as the login flow / create-admin bootstrap script
    // (apps/api-internal/scripts/create-admin.ts) -- no separate hashing
    // approach invented for this path.
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const result = await pool.query<ReviewerRow>(
        `INSERT INTO reviewers (name, email, role, active, password_hash)
         VALUES ($1, $2, $3, true, $4)
         RETURNING id, name, email, role, active`,
        [name, email, body.role, passwordHash],
      );
      const response: { reviewer: Reviewer } = { reviewer: toReviewer(result.rows[0]) };
      res.status(201).json(response);
    } catch (err) {
      // reviewers.email has a UNIQUE constraint (migration 0003).
      if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
        throw new ApiError(409, "email_taken", `A reviewer with email ${email} already exists.`);
      }
      throw err;
    }
  }),
);

reviewersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw new ApiError(400, "invalid_request", "id must be a valid UUID.");
    }
    const body = (req.body ?? {}) as UpdateReviewerRequest;

    if (body.role !== undefined && !VALID_ROLES.includes(body.role)) {
      throw new ApiError(400, "invalid_request", `role must be one of ${VALID_ROLES.join(", ")}.`);
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      throw new ApiError(400, "invalid_request", "active must be a boolean.");
    }
    if (body.role === undefined && body.active === undefined) {
      throw new ApiError(400, "invalid_request", "At least one of role or active must be provided.");
    }

    const existing = await pool.query<ReviewerRow>(`SELECT id, name, email, role, active FROM reviewers WHERE id = $1`, [id]);
    if (!existing.rows[0]) {
      throw new ApiError(404, "not_found", `No reviewer with id ${id}.`);
    }

    const nextRole = body.role ?? existing.rows[0].role;
    const nextActive = body.active ?? existing.rows[0].active;

    const result = await pool.query<ReviewerRow>(
      `UPDATE reviewers SET role = $1, active = $2 WHERE id = $3
       RETURNING id, name, email, role, active`,
      [nextRole, nextActive, id],
    );

    const response: { reviewer: Reviewer } = { reviewer: toReviewer(result.rows[0]) };
    res.status(200).json(response);
  }),
);
