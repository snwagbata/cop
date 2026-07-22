import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { LoginRequest, LoginResponse } from "@cop/shared-types";
import { query } from "../db.js";
import { sendError } from "../errors.js";
import { asyncHandler } from "../asyncHandler.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface ReviewerAuthRow {
  [key: string]: unknown;
  id: string;
  name: string;
  email: string;
  role: "admin" | "reviewer";
  active: boolean;
  password_hash: string | null;
}

export const authRouter = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<LoginRequest>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      sendError(res, 400, "invalid_request", "email and password are required.");
      return;
    }

    const result = await query<ReviewerAuthRow>(
      `SELECT id, name, email, role, active, password_hash
         FROM reviewers
        WHERE lower(email) = $1`,
      [email],
    );
    const reviewer = result.rows[0];

    // Same 401 whether the reviewer doesn't exist, has no password set yet,
    // or the password is wrong -- don't leak which case it was.
    if (!reviewer || !reviewer.password_hash || !reviewer.active) {
      sendError(res, 401, "invalid_credentials", "Invalid email or password.");
      return;
    }

    const matches = await bcrypt.compare(password, reviewer.password_hash);
    if (!matches) {
      sendError(res, 401, "invalid_credentials", "Invalid email or password.");
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await query(
      `INSERT INTO reviewer_sessions (reviewer_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [reviewer.id, token, expiresAt.toISOString()],
    );

    const response: LoginResponse = {
      token,
      expiresAt: expiresAt.toISOString(),
      reviewer: {
        id: reviewer.id,
        name: reviewer.name,
        email: reviewer.email,
        role: reviewer.role,
        active: reviewer.active,
      },
    };
    res.status(200).json(response);
  }),
);
