import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin } from "./helpers.js";
import { resetDb, superPool, TEST_ADMIN } from "./db.js";

describe("GET /record-revisions (audit log)", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsAdmin();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("paginates results", async () => {
    // Seed already ships 4 record_revisions rows; add enough to force a
    // second page at a small pageSize.
    for (let i = 0; i < 6; i++) {
      await superPool.query(
        `INSERT INTO record_revisions (record_type, record_id, change_type, diff, changed_by)
         VALUES ('officer', gen_random_uuid(), 'update', $1, $2)`,
        [JSON.stringify({ note: `pagination fixture ${i}` }), TEST_ADMIN.id],
      );
    }

    const page1 = await request(app)
      .get("/api/internal/record-revisions?page=1&pageSize=5")
      .set(...authHeader(token));
    expect(page1.status).toBe(200);
    expect(page1.body.revisions).toHaveLength(5);
    expect(page1.body.pageInfo).toMatchObject({ page: 1, pageSize: 5, totalCount: 10 });

    const page2 = await request(app)
      .get("/api/internal/record-revisions?page=2&pageSize=5")
      .set(...authHeader(token));
    expect(page2.status).toBe(200);
    expect(page2.body.revisions).toHaveLength(5);
    expect(page2.body.pageInfo).toMatchObject({ page: 2, pageSize: 5, totalCount: 10 });

    // No overlap between pages.
    const page1Ids = new Set(page1.body.revisions.map((r: { id: string }) => r.id));
    for (const r of page2.body.revisions) {
      expect(page1Ids.has(r.id)).toBe(false);
    }
  });

  it("filters by recordType", async () => {
    const res = await request(app)
      .get("/api/internal/record-revisions?recordType=incident")
      .set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.revisions.length).toBeGreaterThan(0);
    for (const r of res.body.revisions) {
      expect(r.recordType).toBe("incident");
    }
  });

  it("rejects an invalid recordType with 400", async () => {
    const res = await request(app)
      .get("/api/internal/record-revisions?recordType=department")
      .set(...authHeader(token));
    expect(res.status).toBe(400);
  });

  it("populates changedByReviewerName via the reviewers join", async () => {
    const res = await request(app)
      .get("/api/internal/record-revisions")
      .set(...authHeader(token));
    expect(res.status).toBe(200);
    // Seed's record_revisions rows are all attributed to the seed's admin
    // reviewer, 'Admin Reviewer' (id ...000021).
    const withKnownReviewer = res.body.revisions.find(
      (r: { changedByReviewerId: string | null }) => r.changedByReviewerId === "00000000-0000-0000-0000-000000000021",
    );
    expect(withKnownReviewer).toBeDefined();
    expect(withKnownReviewer.changedByReviewerName).toBe("Admin Reviewer");
  });
});
