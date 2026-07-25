import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin, loginAsReviewer } from "./helpers.js";
import { resetDb } from "./db.js";
import { superPool } from "./db.js";

const ROBERT_SMITH = "00000000-0000-0000-0000-000000000012"; // the seeded "wandering officer" -- has 2 department_department_history rows
const JANE_DOE = "00000000-0000-0000-0000-000000000011";
const SPRINGFIELD_DEPT = "00000000-0000-0000-0000-000000000001";
const SHELBYVILLE_DEPT = "00000000-0000-0000-0000-000000000002";

describe("GET /officers/:id", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsReviewer(); // not admin -- proves no admin gating
  });

  it("requires authentication", async () => {
    const res = await request(app).get(`/api/internal/officers/${ROBERT_SMITH}`);
    expect(res.status).toBe(401);
  });

  it("rejects a malformed id with 400", async () => {
    const res = await request(app).get("/api/internal/officers/not-a-uuid").set(...authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("404s for an unknown id", async () => {
    const res = await request(app)
      .get("/api/internal/officers/00000000-0000-0000-0000-0000000000ff")
      .set(...authHeader(token));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns full internal detail including department history for the seeded wandering officer", async () => {
    const res = await request(app).get(`/api/internal/officers/${ROBERT_SMITH}`).set(...authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ROBERT_SMITH,
      firstName: "Robert",
      lastName: "Smith",
      departmentId: SPRINGFIELD_DEPT,
      departmentName: "Springfield Police Department (fictional)",
      badgeNumber: "303",
      postCertificationId: "CA-POST-000222",
    });
    expect(res.body.departmentHistory).toHaveLength(2);
    const departmentIds = res.body.departmentHistory.map((h: { departmentId: string }) => h.departmentId).sort();
    expect(departmentIds).toEqual([SHELBYVILLE_DEPT, SPRINGFIELD_DEPT].sort());
    expect(typeof res.body.incidentCount).toBe("number");
    expect(typeof res.body.outcomeCount).toBe("number");
  });

  it("returns department history for an officer", async () => {
    const res = await request(app).get(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.departmentHistory).toHaveLength(1);
    expect(res.body.departmentHistory[0].departmentId).toBe(SPRINGFIELD_DEPT);
  });
});

describe("PATCH /officers/:id", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsReviewer();
  });

  it("requires authentication", async () => {
    const res = await request(app).patch(`/api/internal/officers/${JANE_DOE}`).send({ rank: "Sergeant" });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed id with 400", async () => {
    const res = await request(app).patch("/api/internal/officers/not-a-uuid").set(...authHeader(token)).send({ rank: "Sergeant" });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown id", async () => {
    const res = await request(app)
      .patch("/api/internal/officers/00000000-0000-0000-0000-0000000000ff")
      .set(...authHeader(token))
      .send({ rank: "Sergeant" });
    expect(res.status).toBe(404);
  });

  it("400s when no editable fields are provided", async () => {
    const res = await request(app).patch(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("400s on an invalid employmentStatus", async () => {
    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(token))
      .send({ employmentStatus: "not-a-real-status" });
    expect(res.status).toBe(400);
  });

  it("400s on a blank firstName", async () => {
    const res = await request(app).patch(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token)).send({ firstName: "   " });
    expect(res.status).toBe(400);
  });

  it("updates a single field and leaves the rest unchanged", async () => {
    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(token))
      .send({ rank: "Lieutenant" });
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token));
    expect(check.body.rank).toBe("Lieutenant");
    expect(check.body.firstName).toBe("Jane"); // unchanged
  });

  it("explicitly clears a nullable field to null when the caller sends null (not just omits it)", async () => {
    // First give Jane a badge number to clear.
    await request(app).patch(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token)).send({ badgeNumber: "999" });

    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(token))
      .send({ badgeNumber: null });
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token));
    expect(check.body.badgeNumber).toBeNull();
  });

  it("resets photo_confirmed when photoUrl changes", async () => {
    await superPool.query(
      `UPDATE officers SET photo_url = 'https://example.gov/old.jpg', photo_confirmed = true, photo_confirmed_by = (SELECT id FROM reviewers LIMIT 1), photo_confirmed_at = now() WHERE id = $1`,
      [JANE_DOE],
    );

    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(token))
      .send({ photoUrl: "https://example.gov/new.jpg" });
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token));
    expect(check.body.photoUrl).toBe("https://example.gov/new.jpg");
    expect(check.body.photoConfirmed).toBe(false);
  });

  it("writes a record_revisions row with change_type update", async () => {
    await request(app).patch(`/api/internal/officers/${JANE_DOE}`).set(...authHeader(token)).send({ rank: "Captain" });

    const revisions = await superPool.query(
      `SELECT change_type, diff FROM record_revisions WHERE record_type = 'officer' AND record_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [JANE_DOE],
    );
    expect(revisions.rows[0].change_type).toBe("update");
    expect(revisions.rows[0].diff).toMatchObject({ rank: "Captain" });
  });

  it("does not require the admin role (loginAsReviewer succeeds)", async () => {
    // token above is already a plain reviewer login, not admin -- this
    // test's real assertion is that every other test in this file, which
    // all use loginAsReviewer, already passed. This test exists to make
    // that intent explicit rather than implicit.
    const adminToken = await loginAsAdmin();
    const res = await request(app)
      .patch(`/api/internal/officers/${JANE_DOE}`)
      .set(...authHeader(adminToken))
      .send({ rank: "Chief" });
    expect(res.status).toBe(200);
  });
});

afterAll(async () => {
  await closeAllPools();
});
