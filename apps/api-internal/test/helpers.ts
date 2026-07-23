import request from "supertest";
import { createApp } from "../src/app.js";
import { pool as appPool } from "../src/db.js";
import { TEST_ADMIN, TEST_REVIEWER, superPool } from "./db.js";

export const app = createApp();

/**
 * Logs in via the real HTTP endpoint (not a shortcut) and returns the
 * bearer token, so every authenticated test exercises the actual
 * login -> token -> authenticated-request flow described in the task spec.
 */
export async function loginAs(credentials: { email: string; password: string }): Promise<string> {
  const res = await request(app).post("/api/internal/auth/login").send(credentials);
  if (res.status !== 200) {
    throw new Error(`loginAs(${credentials.email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export async function loginAsAdmin(): Promise<string> {
  return loginAs({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
}

export async function loginAsReviewer(): Promise<string> {
  return loginAs({ email: TEST_REVIEWER.email, password: TEST_REVIEWER.password });
}

export function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

/** Closes both the app's (cop_internal_api-role) pool and the superuser test
 * pool so `vitest run` can exit cleanly instead of hanging on open sockets. */
export async function closeAllPools(): Promise<void> {
  await appPool.end();
  await superPool.end();
}
