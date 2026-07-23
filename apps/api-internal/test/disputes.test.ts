import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin } from "./helpers.js";
import { resetDb, superPool, TEST_ADMIN } from "./db.js";

const OFFICER_ROBERT_SMITH = "00000000-0000-0000-0000-000000000012";

describe("disputes", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsAdmin();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("GET /disputes?status=open returns the seeded open dispute", async () => {
    const res = await request(app)
      .get("/api/internal/disputes?status=open")
      .set(...authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.disputes).toHaveLength(1);
    expect(res.body.disputes[0]).toMatchObject({
      officerId: OFFICER_ROBERT_SMITH,
      requesterRole: "attorney",
      status: "open",
    });
  });

  it("POST /:id/resolve updates status, resolutionNotes, resolvedBy, and resolvedAt", async () => {
    const listRes = await request(app)
      .get("/api/internal/disputes?status=open")
      .set(...authHeader(token));
    const id = listRes.body.disputes[0].id;

    const res = await request(app)
      .post(`/api/internal/disputes/${id}/resolve`)
      .set(...authHeader(token))
      .send({ status: "resolved_no_change", resolutionNotes: "Reviewed personnel file; termination stands." });

    expect(res.status).toBe(200);
    expect(res.body.dispute).toMatchObject({
      id,
      status: "resolved_no_change",
      resolutionNotes: "Reviewed personnel file; termination stands.",
      resolvedBy: TEST_ADMIN.id,
    });
    expect(res.body.dispute.resolvedAt).not.toBeNull();
    expect(new Date(res.body.dispute.resolvedAt).toString()).not.toBe("Invalid Date");
  });

  it("resolving an already-resolved dispute again returns an error", async () => {
    const listRes = await request(app)
      .get("/api/internal/disputes?status=open")
      .set(...authHeader(token));
    const id = listRes.body.disputes[0].id;

    const first = await request(app)
      .post(`/api/internal/disputes/${id}/resolve`)
      .set(...authHeader(token))
      .send({ status: "resolved_corrected", resolutionNotes: "Corrected the record." });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/internal/disputes/${id}/resolve`)
      .set(...authHeader(token))
      .send({ status: "resolved_no_change", resolutionNotes: "Trying again." });

    expect(second.status).toBe(400);
    expect(second.body.error).toBe("already_resolved");
  });

  it("resolving a nonexistent dispute id returns 404", async () => {
    const res = await request(app)
      .post("/api/internal/disputes/99999999-9999-9999-9999-999999999999/resolve")
      .set(...authHeader(token))
      .send({ status: "resolved_no_change", resolutionNotes: "n/a" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("rejects a resolve request missing resolutionNotes with 400", async () => {
    const listRes = await request(app)
      .get("/api/internal/disputes?status=open")
      .set(...authHeader(token));
    const id = listRes.body.disputes[0].id;

    const res = await request(app)
      .post(`/api/internal/disputes/${id}/resolve`)
      .set(...authHeader(token))
      .send({ status: "resolved_no_change" });
    expect(res.status).toBe(400);
  });

  it("rejects status=open as a resolve target (open is not a resolvable status)", async () => {
    const listRes = await request(app)
      .get("/api/internal/disputes?status=open")
      .set(...authHeader(token));
    const id = listRes.body.disputes[0].id;

    const res = await request(app)
      .post(`/api/internal/disputes/${id}/resolve`)
      .set(...authHeader(token))
      .send({ status: "open", resolutionNotes: "n/a" });
    expect(res.status).toBe(400);
  });
});
