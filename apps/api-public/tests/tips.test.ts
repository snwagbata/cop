import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { IncidentCandidateProposal } from "@cop/shared-types";
import { freshApp } from "./helpers/freshApp.js";
import { adminPool, closeAdminPool, resetDb } from "./helpers/db.js";

// Same rationale as disputes.test.ts: POST /api/public/tips is rate-limited
// per req.ip, and supertest can't vary the ip per test, so each test gets a
// freshly-imported app module (a brand-new in-memory rate-limit Map).
let app: Express;

beforeEach(async () => {
  await resetDb();
  app = await freshApp();
});

afterEach(() => {
  // See disputes.test.ts: freshApp() opens a new pg Pool per import; let it
  // idle-close rather than ending it mid-suite.
});

afterAll(async () => {
  await closeAdminPool();
});

function validTipBody(overrides: Record<string, unknown> = {}) {
  return {
    description: "I saw an officer strike a handcuffed person outside the courthouse on Elm St.",
    ...overrides,
  };
}

describe("POST /api/public/tips", () => {
  it("accepts a minimal valid submission (description only) and returns only { success: true }", async () => {
    const res = await request(app).post("/api/public/tips").send(validTipBody());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
  });

  it("accepts a submission with every optional field set", async () => {
    const res = await request(app)
      .post("/api/public/tips")
      .send(
        validTipBody({
          officerNameAsReported: "Officer J. Rourke",
          departmentNameAsReported: "Riverdale Police Department",
          incidentType: "use_of_force",
          incidentDateAsReported: "sometime last spring",
          externalUrl: "https://example.com/bodycam-clip",
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
  });

  it("returns 400 when description is missing", async () => {
    const res = await request(app).post("/api/public/tips").send(validTipBody({ description: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("returns 400 when description is empty/whitespace-only", async () => {
    const res = await request(app).post("/api/public/tips").send(validTipBody({ description: "   " }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("returns 400 when incidentType is not a valid IncidentType", async () => {
    const res = await request(app).post("/api/public/tips").send(validTipBody({ incidentType: "not_a_real_type" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("rate-limits after the configured threshold (3 requests per window per caller)", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/public/tips")
        .send(validTipBody({ description: `Rate limit probe #${i}.` }));
      expect(res.status).toBe(201);
    }
    const fourth = await request(app)
      .post("/api/public/tips")
      .send(validTipBody({ description: "Rate limit probe #4." }));
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toBe("rate_limited");
  });

  describe("the rows it writes", () => {
    it("inserts a tip_submission source (tier4, url set) and a matching low-confidence review_queue row", async () => {
      const res = await request(app)
        .post("/api/public/tips")
        .send(
          validTipBody({
            officerNameAsReported: "Officer J. Rourke",
            departmentNameAsReported: "Riverdale Police Department",
            incidentType: "use_of_force",
            incidentDateAsReported: "sometime last spring",
            externalUrl: "https://example.com/bodycam-clip",
          }),
        );
      expect(res.status).toBe(201);

      const sourceRows = await adminPool.query(
        `SELECT id, source_type, url, reliability_tier FROM sources WHERE source_type = 'tip_submission'`,
      );
      expect(sourceRows.rowCount).toBe(1);
      expect(sourceRows.rows[0]).toMatchObject({
        source_type: "tip_submission",
        url: "https://example.com/bodycam-clip",
        reliability_tier: "tier4_submitted_unverified",
      });

      // Seed data (loaded by resetDb) already has its own review_queue rows
      // for the admin app's tests, so scope this query to the row tied to
      // the tip_submission source just created rather than assuming the
      // table starts empty.
      const queueRows = await adminPool.query(
        `SELECT proposed_record, match_confidence, status, source_id
           FROM review_queue WHERE source_id = $1`,
        [sourceRows.rows[0].id],
      );
      expect(queueRows.rowCount).toBe(1);
      const row = queueRows.rows[0];
      expect(row.match_confidence).toBe("low");
      expect(row.status).toBe("pending");
      expect(row.source_id).toBe(sourceRows.rows[0].id); // linked to the source just inserted

      const proposal = row.proposed_record as IncidentCandidateProposal;
      expect(proposal.type).toBe("incident_candidate");
      expect(proposal.officerId).toBeUndefined();
      expect(proposal.officerName).toBe("Officer J. Rourke");
      expect(proposal.departmentName).toBe("Riverdale Police Department");
      expect(proposal.incidentType).toBe("use_of_force");
      expect(proposal.shortDescription).toBe(validTipBody().description);
      expect(proposal.date).toBe("sometime last spring");
      expect(proposal.externalUrl).toBe("https://example.com/bodycam-clip");
      expect(proposal.note).toMatch(/anonymous public tip/i);
    });

    it("links the review_queue row's source_id to the actual created source id", async () => {
      await request(app).post("/api/public/tips").send(validTipBody());

      const sourceRows = await adminPool.query(`SELECT id FROM sources WHERE source_type = 'tip_submission'`);
      expect(sourceRows.rowCount).toBe(1);
      const queueRows = await adminPool.query(`SELECT source_id FROM review_queue WHERE source_id = $1`, [
        sourceRows.rows[0].id,
      ]);
      expect(queueRows.rowCount).toBe(1);
      expect(queueRows.rows[0].source_id).toBe(sourceRows.rows[0].id);
    });

    it("stores a null source url and an 'Unknown' department placeholder when optional fields are omitted", async () => {
      await request(app).post("/api/public/tips").send(validTipBody());

      const sourceRows = await adminPool.query(`SELECT id, url FROM sources WHERE source_type = 'tip_submission'`);
      expect(sourceRows.rows[0].url).toBeNull();

      const queueRows = await adminPool.query(`SELECT proposed_record FROM review_queue WHERE source_id = $1`, [
        sourceRows.rows[0].id,
      ]);
      const proposal = queueRows.rows[0].proposed_record as IncidentCandidateProposal;
      expect(proposal.departmentName).toBe("Unknown — reported via anonymous tip");
      expect(proposal.incidentType).toBe("other");
      expect(proposal.officerName).toBeUndefined();
      expect(proposal.externalUrl).toBeUndefined();
    });

    it("does not create rows in either table when validation fails", async () => {
      // Seed data already has its own review_queue rows, so assert on the
      // before/after delta rather than an absolute count of 0.
      const before = await adminPool.query(`SELECT count(*)::int AS n FROM review_queue`);

      const res = await request(app).post("/api/public/tips").send(validTipBody({ description: "" }));
      expect(res.status).toBe(400);

      const sourceRows = await adminPool.query(`SELECT * FROM sources WHERE source_type = 'tip_submission'`);
      const after = await adminPool.query(`SELECT count(*)::int AS n FROM review_queue`);
      expect(sourceRows.rowCount).toBe(0);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });
});
