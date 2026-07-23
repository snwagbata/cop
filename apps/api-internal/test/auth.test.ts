import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader } from "./helpers.js";
import { resetDb, superPool, TEST_ADMIN } from "./db.js";

describe("auth", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("logs in with correct credentials and returns a usable token", async () => {
    const res = await request(app)
      .post("/api/internal/auth/login")
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(10);
    expect(res.body.reviewer).toMatchObject({
      id: TEST_ADMIN.id,
      email: TEST_ADMIN.email,
      role: "admin",
      active: true,
    });
    // Password hash must never be echoed back.
    expect(Object.keys(res.body.reviewer).sort()).toEqual(["active", "email", "id", "name", "role"]);

    // The token actually works on a protected route.
    const authed = await request(app)
      .get("/api/internal/review-queue")
      .set(...authHeader(res.body.token));
    expect(authed.status).toBe(200);
  });

  it("rejects a wrong password with a generic 401", async () => {
    const res = await request(app)
      .post("/api/internal/auth/login")
      .send({ email: TEST_ADMIN.email, password: "definitely-not-the-password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
    expect(res.body.message).toBe("Invalid email or password.");
  });

  it("rejects an unknown email with the exact same generic 401 message", async () => {
    const res = await request(app)
      .post("/api/internal/auth/login")
      .send({ email: "no-such-reviewer@cop-tests.example", password: "whatever12345" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
    expect(res.body.message).toBe("Invalid email or password.");
  });

  it("does not distinguish wrong-password from unknown-email in status/body shape", async () => {
    const wrongPassword = await request(app)
      .post("/api/internal/auth/login")
      .send({ email: TEST_ADMIN.email, password: "wrong-password-xyz" });
    const unknownEmail = await request(app)
      .post("/api/internal/auth/login")
      .send({ email: "totally-unknown@cop-tests.example", password: "wrong-password-xyz" });

    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it("rejects missing email/password with 400", async () => {
    const res = await request(app).post("/api/internal/auth/login").send({ email: TEST_ADMIN.email });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 401 on a protected route with a bogus bearer token", async () => {
    const res = await request(app)
      .get("/api/internal/review-queue")
      .set(...authHeader("this-is-not-a-real-token"));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("returns 401 on a protected route with an expired session token", async () => {
    // Log in, then backdate the session's expires_at directly so the token
    // is real (correct length/shape) but expired -- exercises the
    // `s.expires_at > now()` clause specifically, not just "bad token".
    const loginRes = await request(app)
      .post("/api/internal/auth/login")
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
    const token = loginRes.body.token as string;

    await superPool.query(`UPDATE reviewer_sessions SET expires_at = now() - interval '1 hour' WHERE token = $1`, [
      token,
    ]);

    const res = await request(app)
      .get("/api/internal/review-queue")
      .set(...authHeader(token));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("returns 401 on a protected route with no Authorization header at all", async () => {
    const res = await request(app).get("/api/internal/review-queue");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("returns 401 for an inactive reviewer even with a valid live session", async () => {
    const loginRes = await request(app)
      .post("/api/internal/auth/login")
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
    const token = loginRes.body.token as string;

    await superPool.query(`UPDATE reviewers SET active = false WHERE id = $1`, [TEST_ADMIN.id]);

    const res = await request(app)
      .get("/api/internal/review-queue")
      .set(...authHeader(token));
    expect(res.status).toBe(401);
  });
});
