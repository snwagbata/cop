import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin, loginAsReviewer } from "./helpers.js";
import { resetDb, TEST_REVIEWER } from "./db.js";

describe("reviewer management (admin-only)", () => {
  let adminToken: string;
  let reviewerToken: string;

  beforeEach(async () => {
    await resetDb();
    adminToken = await loginAsAdmin();
    reviewerToken = await loginAsReviewer();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("an admin account can list reviewers", async () => {
    const res = await request(app)
      .get("/api/internal/reviewers")
      .set(...authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.reviewers.some((r: { email: string }) => r.email === TEST_REVIEWER.email)).toBe(true);
  });

  it("an admin account can create a new reviewer", async () => {
    const res = await request(app)
      .post("/api/internal/reviewers")
      .set(...authHeader(adminToken))
      .send({ name: "New Reviewer", email: "new-reviewer@cop-tests.example", role: "reviewer", password: "a-fine-password-1" });

    expect(res.status).toBe(201);
    expect(res.body.reviewer).toMatchObject({ name: "New Reviewer", email: "new-reviewer@cop-tests.example", role: "reviewer", active: true });
  });

  it("an admin account can PATCH a reviewer's role/active state", async () => {
    const res = await request(app)
      .patch(`/api/internal/reviewers/${TEST_REVIEWER.id}`)
      .set(...authHeader(adminToken))
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body.reviewer).toMatchObject({ id: TEST_REVIEWER.id, active: false });
  });

  it("a reviewer-role account gets 403 on GET /reviewers", async () => {
    const res = await request(app)
      .get("/api/internal/reviewers")
      .set(...authHeader(reviewerToken));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("a reviewer-role account gets 403 on POST /reviewers", async () => {
    const res = await request(app)
      .post("/api/internal/reviewers")
      .set(...authHeader(reviewerToken))
      .send({ name: "Should Not Work", email: "should-not-work@cop-tests.example", role: "reviewer", password: "irrelevant1" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");

    // Confirm it actually wasn't created, i.e. this is real enforcement, not
    // just a 403 that happens to still let the write through.
    const listRes = await request(app)
      .get("/api/internal/reviewers")
      .set(...authHeader(adminToken));
    expect(listRes.body.reviewers.some((r: { email: string }) => r.email === "should-not-work@cop-tests.example")).toBe(
      false,
    );
  });

  it("a reviewer-role account gets 403 on PATCH /reviewers/:id", async () => {
    const res = await request(app)
      .patch(`/api/internal/reviewers/${TEST_REVIEWER.id}`)
      .set(...authHeader(reviewerToken))
      .send({ active: false });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("creating a reviewer with a duplicate email fails cleanly with 409", async () => {
    const res = await request(app)
      .post("/api/internal/reviewers")
      .set(...authHeader(adminToken))
      .send({ name: "Duplicate", email: TEST_REVIEWER.email, role: "reviewer", password: "another-password-1" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_taken");
  });

  it("rejects a reviewer create with a too-short password with 400", async () => {
    const res = await request(app)
      .post("/api/internal/reviewers")
      .set(...authHeader(adminToken))
      .send({ name: "Short Pw", email: "short-pw@cop-tests.example", role: "reviewer", password: "short" });
    expect(res.status).toBe(400);
  });

  it("PATCH on a nonexistent reviewer id returns 404", async () => {
    const res = await request(app)
      .patch("/api/internal/reviewers/99999999-9999-9999-9999-999999999999")
      .set(...authHeader(adminToken))
      .send({ active: false });
    expect(res.status).toBe(404);
  });
});
