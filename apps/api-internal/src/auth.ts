import type { NextFunction, Request, Response } from "express";
import { query } from "./db.js";
import { sendError } from "./errors.js";

interface SessionRow {
  [key: string]: unknown;
  reviewer_id: string;
  name: string;
  email: string;
  role: "admin" | "reviewer";
  active: boolean;
}

/**
 * Requires `Authorization: Bearer <token>` on every /api/internal/* route
 * except login. Validates the token against reviewer_sessions (must exist
 * and not be expired) and attaches the resolved reviewer to req.reviewer
 * for use as changed_by/reviewer_id downstream.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    sendError(res, 401, "unauthorized", "Missing or malformed Authorization header.");
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    sendError(res, 401, "unauthorized", "Missing bearer token.");
    return;
  }

  const result = await query<SessionRow>(
    `SELECT r.id AS reviewer_id, r.name, r.email, r.role, r.active
       FROM reviewer_sessions s
       JOIN reviewers r ON r.id = s.reviewer_id
      WHERE s.token = $1
        AND s.expires_at > now()`,
    [token],
  );

  const row = result.rows[0];
  if (!row) {
    sendError(res, 401, "unauthorized", "Session token is invalid or expired.");
    return;
  }
  if (!row.active) {
    sendError(res, 401, "unauthorized", "Reviewer account is inactive.");
    return;
  }

  req.reviewer = {
    id: row.reviewer_id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
  };
  next();
}
