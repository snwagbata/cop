import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { freshApp } from "./helpers/freshApp.js";
import { closeAdminPool, resetDb } from "./helpers/db.js";
import { JANE_DOE_ID, MALFORMED_ID, NONEXISTENT_UUID, OUTCOME_TERMINATION_ID } from "./helpers/fixtures.js";

// Every test in this file gets both a clean DB *and* a freshly-imported app
// instance (see tests/helpers/freshApp.ts) — POST /disputes is rate-limited
// per req.ip, which supertest can't vary per test, so a fresh module
// instance (fresh in-memory limiter Map) is this app's only available
// substitute for "a dedicated test IP/key" that keeps one test's requests
// from counting against another's rate-limit window.
let app: Express;

beforeEach(async () => {
  await resetDb();
  app = await freshApp();
});

afterEach(() => {
  // freshApp() opens a brand-new pg Pool each time (module state reset);
  // let it idle-close on pg's default idleTimeoutMillis rather than ending
  // it here, since ending mid-suite risks racing an in-flight query from
  // the just-completed test.
});

afterAll(async () => {
  await closeAdminPool();
});

function validDisputeBody(overrides: Record<string, unknown> = {}) {
  return {
    officerId: JANE_DOE_ID,
    requesterName: "Test Requester",
    requesterRole: "subject",
    claim: "This record misidentifies the officer involved.",
    ...overrides,
  };
}

describe("POST /api/public/disputes", () => {
  it("accepts a valid submission with exactly one target set and returns a Dispute", async () => {
    const res = await request(app).post("/api/public/disputes").send(validDisputeBody());
    expect(res.status).toBe(201);
    expect(res.body.dispute).toMatchObject({
      officerId: JANE_DOE_ID,
      incidentId: null,
      outcomeId: null,
      requesterName: "Test Requester",
      requesterRole: "subject",
      claim: "This record misidentifies the officer involved.",
      status: "open",
      resolutionNotes: null,
      resolvedBy: null,
      resolvedAt: null,
    });
    expect(typeof res.body.dispute.id).toBe("string");
    expect(typeof res.body.dispute.submittedAt).toBe("string");
  });

  it("accepts a valid submission targeting an outcome", async () => {
    const res = await request(app)
      .post("/api/public/disputes")
      .send(validDisputeBody({ officerId: undefined, outcomeId: OUTCOME_TERMINATION_ID }));
    expect(res.status).toBe(201);
    expect(res.body.dispute.outcomeId).toBe(OUTCOME_TERMINATION_ID);
    expect(res.body.dispute.officerId).toBeNull();
  });

  it("returns 400 when two targets are set", async () => {
    const res = await request(app)
      .post("/api/public/disputes")
      .send(validDisputeBody({ outcomeId: OUTCOME_TERMINATION_ID })); // officerId + outcomeId both set
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
    expect(res.body.message).toMatch(/exactly one/i);
  });

  it("returns 400 when zero targets are set", async () => {
    const res = await request(app)
      .post("/api/public/disputes")
      .send(validDisputeBody({ officerId: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
    expect(res.body.message).toMatch(/exactly one/i);
  });

  it("returns 400 when requesterName is missing", async () => {
    const res = await request(app)
      .post("/api/public/disputes")
      .send(validDisputeBody({ requesterName: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("returns 400 when requesterRole is missing", async () => {
    const res = await request(app)
      .post("/api/public/disputes")
      .send(validDisputeBody({ requesterRole: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("returns 400 when claim is missing", async () => {
    const res = await request(app).post("/api/public/disputes").send(validDisputeBody({ claim: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("does not surface a raw DB error for the two/zero-target cases (clean 400, not 500)", async () => {
    // Mirrors the DB's disputes_exactly_one_target CHECK constraint, but
    // should be caught at the API layer before ever reaching Postgres.
    const zero = await request(app).post("/api/public/disputes").send(validDisputeBody({ officerId: undefined }));
    expect(zero.status).toBe(400);
    expect(zero.status).not.toBe(500);
  });

  it("rate-limits after the configured threshold (5 requests per window per caller)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/public/disputes")
        .send(validDisputeBody({ claim: `Rate limit probe #${i}.` }));
      expect(res.status).toBe(201);
    }
    const sixth = await request(app)
      .post("/api/public/disputes")
      .send(validDisputeBody({ claim: "Rate limit probe #6." }));
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe("rate_limited");
  });
});

describe("GET /api/public/disputes/:id", () => {
  it("returns only {id, status, submittedAt, resolvedAt} — never the requester/claim/evidence/resolution fields", async () => {
    const created = await request(app).post("/api/public/disputes").send(validDisputeBody());
    expect(created.status).toBe(201);
    const id = created.body.dispute.id;

    const res = await request(app).get(`/api/public/disputes/${id}`);
    expect(res.status).toBe(200);

    expect(Object.keys(res.body).sort()).toEqual(["id", "resolvedAt", "status", "submittedAt"].sort());
    expect(res.body.id).toBe(id);
    expect(res.body.status).toBe("open");
    expect(typeof res.body.submittedAt).toBe("string");
    expect(res.body.resolvedAt).toBeNull();

    // Explicitly assert the sensitive fields are absent, not just unequal —
    // this is the entire point of this endpoint's narrow response shape.
    expect(res.body).not.toHaveProperty("requesterName");
    expect(res.body).not.toHaveProperty("requesterRole");
    expect(res.body).not.toHaveProperty("claim");
    expect(res.body).not.toHaveProperty("evidenceUrl");
    expect(res.body).not.toHaveProperty("resolutionNotes");
    expect(res.body).not.toHaveProperty("resolvedBy");
  });

  it("returns 404 for an unknown (valid-UUID) dispute id", async () => {
    const res = await request(app).get(`/api/public/disputes/${NONEXISTENT_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 400 for a malformed dispute id", async () => {
    const res = await request(app).get(`/api/public/disputes/${MALFORMED_ID}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });
});
