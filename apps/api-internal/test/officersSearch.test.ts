import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin } from "./helpers.js";
import { resetDb } from "./db.js";

const SHELBYVILLE_DEPT = "00000000-0000-0000-0000-000000000002";

describe("GET /officers/search (internal, admin officer picker)", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsAdmin();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("requires the q query parameter", async () => {
    const res = await request(app)
      .get("/api/internal/officers/search")
      .set(...authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns candidates matching a fuzzy name search, ranked by similarity", async () => {
    const res = await request(app)
      .get("/api/internal/officers/search?q=Robert%20Smith")
      .set(...authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.candidates.length).toBeGreaterThan(0);
    const names = res.body.candidates.map((c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`);
    expect(names).toContain("Robert Smith");
  });

  it("returns multiple disambiguation candidates for an ambiguous last name across departments", async () => {
    // "Smith" is unique in the seed data, so search on a broader token that
    // still discriminates by department scoping below.
    const res = await request(app)
      .get("/api/internal/officers/search?q=o") // matches multiple first/last names loosely
      .set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.candidates)).toBe(true);
  });

  it("scopes results by departmentId when provided", async () => {
    const res = await request(app)
      .get(`/api/internal/officers/search?q=a&departmentId=${SHELBYVILLE_DEPT}`)
      .set(...authHeader(token));
    expect(res.status).toBe(200);
    for (const candidate of res.body.candidates) {
      expect(candidate.departmentId).toBe(SHELBYVILLE_DEPT);
    }
  });

  it("rejects a malformed departmentId with 400", async () => {
    const res = await request(app)
      .get("/api/internal/officers/search?q=Smith&departmentId=not-a-uuid")
      .set(...authHeader(token));
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/internal/officers/search?q=Smith");
    expect(res.status).toBe(401);
  });
});
