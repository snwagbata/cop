import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { closeAdminPool, resetDb } from "./helpers/db.js";
import { MARIA_NGUYEN_ID, SHELBYVILLE_DEPT_ID } from "./helpers/fixtures.js";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeAdminPool();
});

describe("GET /api/public/officers (browse)", () => {
  it("returns pageInfo.totalCount matching the real seeded officer count", async () => {
    const res = await request(app).get("/api/public/officers");
    expect(res.status).toBe(200);
    expect(res.body.pageInfo.totalCount).toBe(3);
    expect(res.body.officers).toHaveLength(3);
  });

  it("applies default page (1) and default pageSize (25) when omitted", async () => {
    const res = await request(app).get("/api/public/officers");
    expect(res.status).toBe(200);
    expect(res.body.pageInfo.page).toBe(1);
    expect(res.body.pageInfo.pageSize).toBe(25);
  });

  it("honors page and pageSize params", async () => {
    const page1 = await request(app).get("/api/public/officers").query({ page: 1, pageSize: 2 });
    expect(page1.status).toBe(200);
    expect(page1.body.officers).toHaveLength(2);
    expect(page1.body.pageInfo).toEqual({ page: 1, pageSize: 2, totalCount: 3 });

    const page2 = await request(app).get("/api/public/officers").query({ page: 2, pageSize: 2 });
    expect(page2.status).toBe(200);
    expect(page2.body.officers).toHaveLength(1);
    expect(page2.body.pageInfo).toEqual({ page: 2, pageSize: 2, totalCount: 3 });

    // No overlap between pages.
    const ids1 = page1.body.officers.map((o: { id: string }) => o.id);
    const ids2 = page2.body.officers.map((o: { id: string }) => o.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it("caps pageSize at 100", async () => {
    const res = await request(app).get("/api/public/officers").query({ pageSize: 500 });
    expect(res.status).toBe(200);
    expect(res.body.pageInfo.pageSize).toBe(100);
    // Only 3 officers actually exist, capped pageSize doesn't invent rows.
    expect(res.body.officers).toHaveLength(3);
  });

  it("filters by departmentId", async () => {
    const res = await request(app).get("/api/public/officers").query({ departmentId: SHELBYVILLE_DEPT_ID });
    expect(res.status).toBe(200);
    expect(res.body.pageInfo.totalCount).toBe(1);
    expect(res.body.officers).toHaveLength(1);
    expect(res.body.officers[0].id).toBe(MARIA_NGUYEN_ID);
  });

  it("returns 400 for a malformed departmentId", async () => {
    const res = await request(app).get("/api/public/officers").query({ departmentId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });
});
