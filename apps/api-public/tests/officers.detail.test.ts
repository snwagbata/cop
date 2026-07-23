import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { STANDARD_OFFICER_PAGE_DISCLAIMER } from "@cop/shared-types";
import { app } from "../src/app.js";
import { adminPool, closeAdminPool, resetDb } from "./helpers/db.js";
import {
  INCIDENT_FALSE_REPORT_SHELBYVILLE_ID,
  INCIDENT_UOF_SPRINGFIELD_ID,
  JANE_DOE_ID,
  MALFORMED_ID,
  NONEXISTENT_UUID,
  OUTCOME_LAWSUIT_SETTLEMENT_AMOUNT_CENTS,
  OUTCOME_LAWSUIT_SETTLEMENT_ID,
  ROBERT_SMITH_ID,
  SHELBYVILLE_DEPT_ID,
  SOURCE_COURT_DOC_SETTLEMENT,
  SOURCE_DECERTIFICATION_REGISTRY,
  SOURCE_NEWS_ARTICLE,
  SPRINGFIELD_DEPT_ID,
} from "./helpers/fixtures.js";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeAdminPool();
});

describe("GET /api/public/officers/:id", () => {
  it("returns full OfficerDetail for Robert Smith, including two departmentHistory entries (badges 55 and 303)", async () => {
    const res = await request(app).get(`/api/public/officers/${ROBERT_SMITH_ID}`);
    expect(res.status).toBe(200);
    const officer = res.body.officer;

    expect(officer.id).toBe(ROBERT_SMITH_ID);
    expect(officer.firstName).toBe("Robert");
    expect(officer.lastName).toBe("Smith");
    expect(officer.badgeNumber).toBe("303"); // current badge
    expect(officer.department.id).toBe(SPRINGFIELD_DEPT_ID); // current department

    expect(officer.departmentHistory).toHaveLength(2);
    // Ordered ASC by start_date: Shelbyville (badge 55) first, then Springfield (badge 303).
    expect(officer.departmentHistory[0]).toMatchObject({
      departmentId: SHELBYVILLE_DEPT_ID,
      badgeNumber: "55",
      startDate: "2015-01-01",
      endDate: "2019-05-31",
      separationReason: "terminated after sustained internal affairs investigation",
    });
    expect(officer.departmentHistory[1]).toMatchObject({
      departmentId: SPRINGFIELD_DEPT_ID,
      badgeNumber: "303",
      startDate: "2019-06-01",
      endDate: null,
    });

    // disclaimer must equal the shared-types constant exactly, not a
    // hand-copied string that could silently drift from it.
    expect(officer.disclaimer).toBe(STANDARD_OFFICER_PAGE_DISCLAIMER);

    // Robert Smith's only linked incident (false-report at Shelbyville).
    expect(officer.incidents).toHaveLength(1);
    const incident = officer.incidents[0];
    expect(incident.id).toBe(INCIDENT_FALSE_REPORT_SHELBYVILLE_ID);
    expect(incident.incidentType).toBe("false_report");
    expect(incident.status).toBe("sustained");
    expect(incident.outcomes).toHaveLength(1);
    expect(incident.outcomes[0]).toMatchObject({ outcomeType: "termination", amountCents: null });

    // The only dispute touching Robert Smith in the seed is still 'open',
    // so it must NOT appear in resolvedDisputes.
    expect(officer.resolvedDisputes).toEqual([]);
  });

  it("returns 404 for a nonexistent (but valid-UUID) officer id", async () => {
    const res = await request(app).get(`/api/public/officers/${NONEXISTENT_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found", message: expect.any(String) });
  });

  it("returns 400 for a malformed officer id", async () => {
    const res = await request(app).get(`/api/public/officers/${MALFORMED_ID}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("reflects resolved disputes touching the officer or their incidents/outcomes", async () => {
    // Seed has no resolved disputes at all — insert one directly (own
    // freshly-inserted row, per db/TESTING.md) targeting Jane Doe's incident.
    await adminPool.query(
      `INSERT INTO disputes
         (incident_id, requester_name, requester_role, claim, status, resolution_notes, resolved_at)
       VALUES ($1, 'Test Requester', 'other', 'Disputes a factual detail in the incident record.',
               'resolved_corrected', 'Corrected the disputed detail after review.', now())`,
      [INCIDENT_UOF_SPRINGFIELD_ID]
    );

    const res = await request(app).get(`/api/public/officers/${JANE_DOE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.officer.resolvedDisputes).toHaveLength(1);
    expect(res.body.officer.resolvedDisputes[0]).toMatchObject({
      targetType: "incident",
      targetId: INCIDENT_UOF_SPRINGFIELD_ID,
      status: "resolved_corrected",
      resolutionNotes: "Corrected the disputed detail after review.",
    });
    expect(typeof res.body.officer.resolvedDisputes[0].resolvedAt).toBe("string");
  });

  // Regression test: outcomes must be citable independently of the incident
  // they belong to. Earlier in this project outcomes had no citation path of
  // their own at all. Seed data: incident 041's own citation is the news
  // article (source 033); its lawsuit_settlement outcome (053) is cited
  // separately by the court-doc settlement order (source 032) — the two
  // must NOT be conflated.
  it("keeps an outcome's citations independent of its incident's citations", async () => {
    const res = await request(app).get(`/api/public/officers/${JANE_DOE_ID}`);
    expect(res.status).toBe(200);
    const incident = res.body.officer.incidents.find((i: { id: string }) => i.id === INCIDENT_UOF_SPRINGFIELD_ID);
    expect(incident).toBeDefined();

    // Incident-level citation: only the news article.
    expect(incident.citations.map((c: { id: string }) => c.id)).toEqual([SOURCE_NEWS_ARTICLE]);
    expect(incident.citations[0].sourceType).toBe("news_article");

    const settlement = incident.outcomes.find((o: { id: string }) => o.id === OUTCOME_LAWSUIT_SETTLEMENT_ID);
    expect(settlement).toBeDefined();
    expect(settlement.amountCents).toBe(OUTCOME_LAWSUIT_SETTLEMENT_AMOUNT_CENTS);
    // Outcome-level citation: only the court doc — NOT the incident's news article.
    expect(settlement.citations.map((c: { id: string }) => c.id)).toEqual([SOURCE_COURT_DOC_SETTLEMENT]);
    expect(settlement.citations[0].sourceType).toBe("court_doc");
    expect(settlement.citations.map((c: { id: string }) => c.id)).not.toContain(SOURCE_NEWS_ARTICLE);

    // The other outcome on the same incident (internal_discipline) has no
    // citations of its own in the seed data.
    const discipline = incident.outcomes.find((o: { outcomeType: string }) => o.outcomeType === "internal_discipline");
    expect(discipline.citations).toEqual([]);
  });

  it("scopes an officer's citation (decertification registry) independently across officer/incident/outcome citable_types", async () => {
    // Source 031 (decertification registry) backs Robert Smith at the
    // officer level, incident 042, and outcome 052 all independently
    // (three separate citations rows in the seed) — the officer-level
    // citation isn't exposed on OfficerDetail (no such field), but the
    // incident/outcome ones should both resolve correctly off the same
    // source id without cross-contamination.
    const res = await request(app).get(`/api/public/officers/${ROBERT_SMITH_ID}`);
    expect(res.status).toBe(200);
    const incident = res.body.officer.incidents[0];
    expect(incident.citations.map((c: { id: string }) => c.id)).toEqual([SOURCE_DECERTIFICATION_REGISTRY]);
    expect(incident.outcomes[0].citations.map((c: { id: string }) => c.id)).toEqual([
      SOURCE_DECERTIFICATION_REGISTRY,
    ]);
  });
});
