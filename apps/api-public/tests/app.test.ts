import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { closeAdminPool, resetDb } from "./helpers/db.js";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeAdminPool();
});

describe("404 handling under /api/public", () => {
  it("returns the shared ApiErrorResponse 404 shape for an unmatched route", async () => {
    const res = await request(app).get("/api/public/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found", message: expect.any(String) });
  });
});

describe("CORS", () => {
  // src/app.ts configures `cors({ origin: ALLOWED_ORIGIN })` with a single
  // fixed string (default "http://localhost:5173", from PUBLIC_WEB_ORIGIN),
  // not a function/whitelist — so the `cors` package always emits that one
  // configured value on Access-Control-Allow-Origin, regardless of what
  // Origin header the request itself sent. It does not reflect the
  // requester's own origin back.
  const ALLOWED_ORIGIN = "http://localhost:5173";

  it("allows the configured origin", async () => {
    const res = await request(app).get("/healthz").set("Origin", ALLOWED_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });

  it("still advertises only the configured origin for a request from a different Origin (does not reflect it)", async () => {
    const res = await request(app).get("/healthz").set("Origin", "http://evil.example");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).not.toBe("http://evil.example");
  });
});
