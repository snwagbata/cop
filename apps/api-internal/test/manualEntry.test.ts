import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin } from "./helpers.js";
import { resetDb, superPool, TEST_ADMIN } from "./db.js";

const SPRINGFIELD_DEPT = "00000000-0000-0000-0000-000000000001";
const OFFICER_JANE_DOE = "00000000-0000-0000-0000-000000000011";
const SOURCE_TIER1_COURT_DOC = "00000000-0000-0000-0000-000000000032";
const INCIDENT_1 = "00000000-0000-0000-0000-000000000041";
const NONEXISTENT_UUID = "99999999-9999-9999-9999-999999999999";

async function countRecordRevisions(): Promise<number> {
  const res = await superPool.query<{ count: string }>(`SELECT count(*) FROM record_revisions`);
  return Number(res.rows[0].count);
}

async function latestRevisionFor(recordId: string): Promise<{ record_type: string; change_type: string; changed_by: string } | undefined> {
  const res = await superPool.query(
    `SELECT record_type, change_type, changed_by FROM record_revisions WHERE record_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [recordId],
  );
  return res.rows[0];
}

describe("manual data entry", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsAdmin();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  describe("departments", () => {
    it("creates a department and returns the record with no revisionId (documented exception)", async () => {
      const before = await countRecordRevisions();
      const res = await request(app)
        .post("/api/internal/departments")
        .set(...authHeader(token))
        .send({ name: "Ogdenville Police Department (fictional)", state: "CA", jurisdictionType: "municipal" });

      expect(res.status).toBe(201);
      expect(res.body.record).toMatchObject({ name: "Ogdenville Police Department (fictional)", state: "CA" });
      expect(res.body.revisionId).toBeUndefined();
      expect(await countRecordRevisions()).toBe(before);
    });

    it("rejects a department create missing required fields with 400", async () => {
      const res = await request(app)
        .post("/api/internal/departments")
        .set(...authHeader(token))
        .send({ name: "Missing State PD" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });
  });

  describe("officers", () => {
    it("creates an officer, returns record + revisionId, and writes a record_revisions row", async () => {
      const res = await request(app)
        .post("/api/internal/officers")
        .set(...authHeader(token))
        .send({ firstName: "Alex", lastName: "Kim", departmentId: SPRINGFIELD_DEPT, badgeNumber: "777" });

      expect(res.status).toBe(201);
      expect(res.body.record).toMatchObject({ firstName: "Alex", lastName: "Kim", badgeNumber: "777" });
      expect(typeof res.body.revisionId).toBe("string");

      const revision = await latestRevisionFor(res.body.record.id);
      expect(revision).toMatchObject({ record_type: "officer", change_type: "create", changed_by: TEST_ADMIN.id });
    });

    it("rejects an officer create with a nonexistent departmentId with 400", async () => {
      const res = await request(app)
        .post("/api/internal/officers")
        .set(...authHeader(token))
        .send({ firstName: "Ghost", lastName: "Dept", departmentId: NONEXISTENT_UUID });
      expect(res.status).toBe(400);
    });

    it("rejects an officer create missing firstName/lastName with 400", async () => {
      const res = await request(app)
        .post("/api/internal/officers")
        .set(...authHeader(token))
        .send({ departmentId: SPRINGFIELD_DEPT });
      expect(res.status).toBe(400);
    });
  });

  describe("sources", () => {
    it("creates a source, returns record + revisionId, and writes a record_revisions row", async () => {
      const res = await request(app)
        .post("/api/internal/sources")
        .set(...authHeader(token))
        .send({
          sourceType: "news_article",
          url: "https://example-news.example/article/manual-entry-test",
          reliabilityTier: "tier3_established_news",
        });

      expect(res.status).toBe(201);
      expect(res.body.record.url).toBe("https://example-news.example/article/manual-entry-test");
      expect(typeof res.body.revisionId).toBe("string");

      const revision = await latestRevisionFor(res.body.record.id);
      expect(revision).toMatchObject({ record_type: "source", change_type: "create" });
    });

    it("rejects a source create with an invalid sourceType with 400", async () => {
      const res = await request(app)
        .post("/api/internal/sources")
        .set(...authHeader(token))
        .send({ sourceType: "not_a_real_type", url: "https://example.example/x", reliabilityTier: "tier3_established_news" });
      expect(res.status).toBe(400);
    });
  });

  describe("incidents", () => {
    it("creates an incident with officers and sources, and writes a record_revisions row", async () => {
      const res = await request(app)
        .post("/api/internal/incidents")
        .set(...authHeader(token))
        .send({
          departmentId: SPRINGFIELD_DEPT,
          date: "2021-01-01",
          incidentType: "other",
          shortDescription: "Manual-entry test incident.",
          officerIds: [OFFICER_JANE_DOE],
          sourceIds: [SOURCE_TIER1_COURT_DOC],
        });

      expect(res.status).toBe(201);
      expect(res.body.record.officers).toHaveLength(1);
      expect(res.body.record.officers[0]).toMatchObject({ officerId: OFFICER_JANE_DOE, involvementRole: "primary" });
      expect(res.body.record.citations).toHaveLength(1);
      expect(res.body.record.citations[0].id).toBe(SOURCE_TIER1_COURT_DOC);
      expect(typeof res.body.revisionId).toBe("string");

      const revision = await latestRevisionFor(res.body.record.id);
      expect(revision).toMatchObject({ record_type: "incident", change_type: "create" });

      const citationRows = await superPool.query(
        `SELECT * FROM citations WHERE citable_type = 'incident' AND citable_id = $1`,
        [res.body.record.id],
      );
      expect(citationRows.rows).toHaveLength(1);
      expect(citationRows.rows[0].source_id).toBe(SOURCE_TIER1_COURT_DOC);
    });

    it("rejects an incident create with an empty officerIds array with 400", async () => {
      const res = await request(app)
        .post("/api/internal/incidents")
        .set(...authHeader(token))
        .send({
          departmentId: SPRINGFIELD_DEPT,
          date: "2021-01-01",
          incidentType: "other",
          shortDescription: "No officers attached.",
          officerIds: [],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("rejects an incident create citing a nonexistent source with 400 and creates nothing", async () => {
      const before = await countRecordRevisions();
      const res = await request(app)
        .post("/api/internal/incidents")
        .set(...authHeader(token))
        .send({
          departmentId: SPRINGFIELD_DEPT,
          date: "2021-01-01",
          incidentType: "other",
          shortDescription: "Cites a source that doesn't exist.",
          officerIds: [OFFICER_JANE_DOE],
          sourceIds: [NONEXISTENT_UUID],
        });
      expect(res.status).toBe(400);
      expect(await countRecordRevisions()).toBe(before);
    });
  });

  describe("outcomes", () => {
    it("creates an outcome citing an existing incident and source, writes a record_revisions row", async () => {
      const res = await request(app)
        .post("/api/internal/outcomes")
        .set(...authHeader(token))
        .send({
          incidentId: INCIDENT_1,
          outcomeType: "internal_discipline",
          sourceIds: [SOURCE_TIER1_COURT_DOC],
        });

      expect(res.status).toBe(201);
      expect(res.body.record.incidentId).toBe(INCIDENT_1);
      expect(res.body.record.citations[0].id).toBe(SOURCE_TIER1_COURT_DOC);
      expect(typeof res.body.revisionId).toBe("string");

      const revision = await latestRevisionFor(res.body.record.id);
      expect(revision).toMatchObject({ record_type: "outcome", change_type: "create" });
    });

    it("rejects an outcome create with a nonexistent incidentId with 400", async () => {
      const res = await request(app)
        .post("/api/internal/outcomes")
        .set(...authHeader(token))
        .send({ incidentId: NONEXISTENT_UUID, outcomeType: "internal_discipline" });
      expect(res.status).toBe(400);
    });
  });

  describe("citations", () => {
    it("creates a citation and writes no record_revisions row (documented exception)", async () => {
      const before = await countRecordRevisions();
      const res = await request(app)
        .post("/api/internal/citations")
        .set(...authHeader(token))
        .send({ sourceId: SOURCE_TIER1_COURT_DOC, citableType: "incident", citableId: INCIDENT_1 });

      expect(res.status).toBe(201);
      expect(res.body.citation).toMatchObject({
        sourceId: SOURCE_TIER1_COURT_DOC,
        citableType: "incident",
        citableId: INCIDENT_1,
      });
      expect(await countRecordRevisions()).toBe(before);
    });

    it("rejects a citation create pointing at a nonexistent source with 400", async () => {
      const res = await request(app)
        .post("/api/internal/citations")
        .set(...authHeader(token))
        .send({ sourceId: NONEXISTENT_UUID, citableType: "incident", citableId: INCIDENT_1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("rejects a citation create pointing at a nonexistent citable record with 400", async () => {
      const res = await request(app)
        .post("/api/internal/citations")
        .set(...authHeader(token))
        .send({ sourceId: SOURCE_TIER1_COURT_DOC, citableType: "incident", citableId: NONEXISTENT_UUID });
      expect(res.status).toBe(400);
    });
  });

  describe("end-to-end chain: source -> department -> officer -> incident -> outcome", () => {
    it("walks the full realistic manual-entry workflow", async () => {
      const sourceRes = await request(app)
        .post("/api/internal/sources")
        .set(...authHeader(token))
        .send({
          sourceType: "public_records_response",
          url: "https://example.gov/records/chain-test",
          reliabilityTier: "tier2_official_dataset",
        });
      expect(sourceRes.status).toBe(201);
      const sourceId = sourceRes.body.record.id;

      const deptRes = await request(app)
        .post("/api/internal/departments")
        .set(...authHeader(token))
        .send({ name: "North Haverbrook Police Department (fictional)", state: "CA", jurisdictionType: "municipal" });
      expect(deptRes.status).toBe(201);
      const departmentId = deptRes.body.record.id;

      const officerRes = await request(app)
        .post("/api/internal/officers")
        .set(...authHeader(token))
        .send({ firstName: "Chain", lastName: "Test", departmentId });
      expect(officerRes.status).toBe(201);
      const officerId = officerRes.body.record.id;

      const incidentRes = await request(app)
        .post("/api/internal/incidents")
        .set(...authHeader(token))
        .send({
          departmentId,
          date: "2020-03-15",
          incidentType: "unlawful_arrest",
          shortDescription: "End-to-end chain test incident.",
          officerIds: [officerId],
          sourceIds: [sourceId],
        });
      expect(incidentRes.status).toBe(201);
      const incidentId = incidentRes.body.record.id;
      expect(incidentRes.body.record.citations.map((c: { id: string }) => c.id)).toEqual([sourceId]);

      const outcomeRes = await request(app)
        .post("/api/internal/outcomes")
        .set(...authHeader(token))
        .send({ incidentId, outcomeType: "no_action", sourceIds: [sourceId] });
      expect(outcomeRes.status).toBe(201);
      expect(outcomeRes.body.record.citations.map((c: { id: string }) => c.id)).toEqual([sourceId]);

      // Confirm the whole chain is actually linked in the DB, not just in
      // the individual responses.
      const officerCheck = await superPool.query(`SELECT department_id FROM officers WHERE id = $1`, [officerId]);
      expect(officerCheck.rows[0].department_id).toBe(departmentId);

      const incidentOfficerCheck = await superPool.query(
        `SELECT 1 FROM incident_officers WHERE incident_id = $1 AND officer_id = $2`,
        [incidentId, officerId],
      );
      expect(incidentOfficerCheck.rows).toHaveLength(1);

      const outcomeCheck = await superPool.query(`SELECT incident_id FROM outcomes WHERE id = $1`, [
        outcomeRes.body.record.id,
      ]);
      expect(outcomeCheck.rows[0].incident_id).toBe(incidentId);

      const citationRows = await superPool.query(
        `SELECT citable_type FROM citations WHERE source_id = $1 ORDER BY citable_type`,
        [sourceId],
      );
      expect(citationRows.rows.map((r: { citable_type: string }) => r.citable_type)).toEqual(["incident", "outcome"]);
    });
  });
});
