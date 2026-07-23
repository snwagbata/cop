import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { closeAdminPool, resetDb } from "./helpers/db.js";
import { JANE_DOE_ID, MARIA_NGUYEN_ID, SHELBYVILLE_DEPT_ID, SPRINGFIELD_DEPT_ID } from "./helpers/fixtures.js";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeAdminPool();
});

describe("GET /api/public/officers/search", () => {
  it("returns all matching officers for a query matching multiple (disambiguation case)", async () => {
    // "o" matches "Jane Doe" and "Robert Smith" but not "Maria Nguyen".
    const res = await request(app).get("/api/public/officers/search").query({ q: "o" });
    expect(res.status).toBe(200);
    const names = res.body.candidates.map((c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`);
    expect(names.sort()).toEqual(["Jane Doe", "Robert Smith"]);
  });

  it("returns exactly one officer for a query matching only one", async () => {
    const res = await request(app).get("/api/public/officers/search").query({ q: "Nguyen" });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe(MARIA_NGUYEN_ID);
  });

  it("returns an empty array for a query matching no officers", async () => {
    const res = await request(app).get("/api/public/officers/search").query({ q: "zzzznomatch" });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
  });

  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/api/public/officers/search");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "bad_request",
      message: expect.stringContaining("q"),
    });
  });

  it("returns 400 when q is empty/whitespace-only", async () => {
    const res = await request(app).get("/api/public/officers/search").query({ q: "   " });
    expect(res.status).toBe(400);
  });

  it("narrows results with a departmentId filter", async () => {
    // "a" unfiltered matches both Jane Doe (Springfield) and Maria Nguyen
    // (Shelbyville) — filtering to Springfield should narrow to just Jane Doe.
    const unfiltered = await request(app).get("/api/public/officers/search").query({ q: "a" });
    expect(unfiltered.status).toBe(200);
    expect(unfiltered.body.candidates.map((c: { id: string }) => c.id).sort()).toEqual(
      [JANE_DOE_ID, MARIA_NGUYEN_ID].sort()
    );

    const filtered = await request(app)
      .get("/api/public/officers/search")
      .query({ q: "a", departmentId: SPRINGFIELD_DEPT_ID });
    expect(filtered.status).toBe(200);
    expect(filtered.body.candidates).toHaveLength(1);
    expect(filtered.body.candidates[0].id).toBe(JANE_DOE_ID);
  });

  it("returns an empty array when departmentId filter excludes all matches", async () => {
    const res = await request(app)
      .get("/api/public/officers/search")
      .query({ q: "o", departmentId: SHELBYVILLE_DEPT_ID });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
  });

  it("returns 400 for a malformed (non-UUID) departmentId", async () => {
    const res = await request(app)
      .get("/api/public/officers/search")
      .query({ q: "o", departmentId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });
});
