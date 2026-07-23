import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { closeAdminPool, resetDb } from "./helpers/db.js";
import {
  MALFORMED_ID,
  NONEXISTENT_UUID,
  SHELBYVILLE_DEPT_ID,
  SHELBYVILLE_STATS,
  SPRINGFIELD_DEPT_ID,
  SPRINGFIELD_STATS,
} from "./helpers/fixtures.js";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeAdminPool();
});

describe("GET /api/public/departments", () => {
  it("lists all seeded departments, ordered by name", async () => {
    const res = await request(app).get("/api/public/departments");
    expect(res.status).toBe(200);
    expect(res.body.departments).toHaveLength(2);
    expect(res.body.departments.map((d: { id: string }) => d.id)).toEqual([
      SHELBYVILLE_DEPT_ID, // "Shelbyville..." sorts before "Springfield..."
      SPRINGFIELD_DEPT_ID,
    ]);
  });
});

describe("GET /api/public/departments/:id/stats", () => {
  it("matches known seed totals for Springfield (has the settlement)", async () => {
    const res = await request(app).get(`/api/public/departments/${SPRINGFIELD_DEPT_ID}/stats`);
    expect(res.status).toBe(200);
    expect(res.body.department.id).toBe(SPRINGFIELD_DEPT_ID);
    expect(res.body.stats).toMatchObject({
      departmentId: SPRINGFIELD_DEPT_ID,
      ...SPRINGFIELD_STATS,
    });
  });

  it("matches known seed totals for Shelbyville (no settlement)", async () => {
    const res = await request(app).get(`/api/public/departments/${SHELBYVILLE_DEPT_ID}/stats`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      departmentId: SHELBYVILLE_DEPT_ID,
      ...SHELBYVILLE_STATS,
    });
  });

  it("returns 404 for a nonexistent department", async () => {
    const res = await request(app).get(`/api/public/departments/${NONEXISTENT_UUID}/stats`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 400 for a malformed department id", async () => {
    const res = await request(app).get(`/api/public/departments/${MALFORMED_ID}/stats`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });
});
