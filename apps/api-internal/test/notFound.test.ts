import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin } from "./helpers.js";
import { resetDb } from "./db.js";

describe("unmatched routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("returns the shared ApiErrorResponse shape for an unknown route, unauthenticated", async () => {
    const res = await request(app).get("/api/internal/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
    expect(res.body.error).toBe("not_found");
    expect(typeof res.body.message).toBe("string");
  });

  it("returns the shared ApiErrorResponse shape for an unknown route, authenticated", async () => {
    const token = await loginAsAdmin();
    const res = await request(app)
      .get("/api/internal/officers/not-a-real-sub-route/nested")
      .set(...authHeader(token));
    expect(res.status).toBe(404);
    expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
  });

  it("healthz is reachable without auth and outside the ApiErrorResponse shape", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
