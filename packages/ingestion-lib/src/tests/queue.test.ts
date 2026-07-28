import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { queueCandidate } from "../queue.js";
import type { CandidateItem } from "../types.js";

describe("queueCandidate", () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(() => {
    pool = createPool(INTERNAL_API_URL);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    client = await pool.connect();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("writes a sources row (with external_ref) and a review_queue row in one transaction", async () => {
    const item: CandidateItem = {
      sourceType: "court_doc",
      externalUrl: "https://example.gov/docket/456",
      externalRef: "docket-456",
      reliabilityTier: "tier1_primary_legal_doc",
      officerNameAsReported: "Jane Doe",
      departmentNameAsReported: SEED.officers.janeDoe.departmentName,
      incidentType: "use_of_force",
      shortDescription: "A civil rights complaint names an officer matching this description.",
      dateAsReported: "2024-01-15",
      note: "Fixture item from packages/ingestion-lib tests.",
    };
    const matchResult = { officerId: SEED.officers.janeDoe.id, confidence: "high" as const };

    try {
      await client.query("BEGIN");
      const { sourceId, reviewQueueId } = await queueCandidate(client, item, matchResult);
      await client.query("COMMIT");

      const sourceRow = await pool.query(
        `SELECT source_type, url, reliability_tier, external_ref FROM sources WHERE id = $1`,
        [sourceId],
      );
      expect(sourceRow.rows[0]).toMatchObject({
        source_type: "court_doc",
        url: item.externalUrl,
        reliability_tier: "tier1_primary_legal_doc",
        external_ref: "docket-456",
      });

      const reviewQueueRow = await pool.query(
        `SELECT proposed_record, match_confidence, status, source_id FROM review_queue WHERE id = $1`,
        [reviewQueueId],
      );
      const row = reviewQueueRow.rows[0];
      expect(row.match_confidence).toBe("high");
      expect(row.status).toBe("pending");
      expect(row.source_id).toBe(sourceId);
      expect(row.proposed_record).toMatchObject({
        type: "incident_candidate",
        officerId: SEED.officers.janeDoe.id,
        departmentName: SEED.officers.janeDoe.departmentName,
        incidentType: "use_of_force",
        shortDescription: item.shortDescription,
        date: "2024-01-15",
        externalUrl: item.externalUrl,
      });
      // officerId matched -> officerName must not also be set (mutually
      // exclusive per IncidentCandidateProposal's documented convention).
      expect(row.proposed_record.officerName).toBeUndefined();
    } finally {
      client.release();
    }
  });

  it("carries officerName (not officerId) forward when the item wasn't matched to an existing officer", async () => {
    const item: CandidateItem = {
      sourceType: "news_article",
      externalUrl: "https://example-news.example/article/unrelated-report",
      externalRef: "https://example-news.example/article/unrelated-report",
      reliabilityTier: "tier3_established_news",
      officerNameAsReported: "Some Unmatched Officer",
      shortDescription: "A news report describing an incident with no confident officer match.",
    };
    const matchResult = { officerId: null, confidence: "low" as const };

    try {
      await client.query("BEGIN");
      const { reviewQueueId } = await queueCandidate(client, item, matchResult);
      await client.query("COMMIT");

      const reviewQueueRow = await pool.query(`SELECT proposed_record, match_confidence FROM review_queue WHERE id = $1`, [
        reviewQueueId,
      ]);
      const row = reviewQueueRow.rows[0];
      expect(row.match_confidence).toBe("low");
      expect(row.proposed_record.officerId).toBeUndefined();
      expect(row.proposed_record.officerName).toBe("Some Unmatched Officer");
      // No departmentNameAsReported given -> the placeholder is used, not a
      // required-field violation.
      expect(row.proposed_record.departmentName).toMatch(/unknown/i);
    } finally {
      client.release();
    }
  });

  it("carries proposedOutcome through unchanged when the item includes one", async () => {
    const item: CandidateItem = {
      sourceType: "official_dataset",
      externalRef: "test-outcome-passthrough",
      reliabilityTier: "tier2_official_dataset",
      officerNameAsReported: "Jane Doe",
      departmentNameAsReported: SEED.officers.janeDoe.departmentName,
      incidentType: "use_of_force",
      shortDescription: "A candidate with a structured outcome attached.",
      dateAsReported: "2024-01-15",
      proposedOutcome: { outcomeType: "internal_discipline", date: "2024-02-01", details: "Command Discipline - A" },
    };
    const matchResult = { officerId: SEED.officers.janeDoe.id, confidence: "high" as const };

    try {
      await client.query("BEGIN");
      const { reviewQueueId } = await queueCandidate(client, item, matchResult);
      await client.query("COMMIT");

      const reviewQueueRow = await pool.query(`SELECT proposed_record FROM review_queue WHERE id = $1`, [
        reviewQueueId,
      ]);
      expect(reviewQueueRow.rows[0].proposed_record.proposedOutcome).toEqual({
        outcomeType: "internal_discipline",
        date: "2024-02-01",
        details: "Command Discipline - A",
      });
    } finally {
      client.release();
    }
  });

  it("omits proposedOutcome entirely (not a null placeholder) when the item doesn't include one", async () => {
    const item: CandidateItem = {
      sourceType: "official_dataset",
      externalRef: "test-outcome-absent",
      reliabilityTier: "tier2_official_dataset",
      officerNameAsReported: "Jane Doe",
      departmentNameAsReported: SEED.officers.janeDoe.departmentName,
      incidentType: "use_of_force",
      shortDescription: "A candidate with no outcome attached.",
      dateAsReported: "2024-01-15",
    };
    const matchResult = { officerId: SEED.officers.janeDoe.id, confidence: "high" as const };

    try {
      await client.query("BEGIN");
      const { reviewQueueId } = await queueCandidate(client, item, matchResult);
      await client.query("COMMIT");

      const reviewQueueRow = await pool.query(`SELECT proposed_record FROM review_queue WHERE id = $1`, [
        reviewQueueId,
      ]);
      expect(reviewQueueRow.rows[0].proposed_record.proposedOutcome).toBeUndefined();
    } finally {
      client.release();
    }
  });

  it("rolls back both inserts together if the transaction is aborted", async () => {
    const item: CandidateItem = {
      sourceType: "court_doc",
      externalRef: "docket-rollback-test",
      reliabilityTier: "tier1_primary_legal_doc",
      shortDescription: "This insert should not survive a ROLLBACK.",
    };
    const matchResult = { officerId: null, confidence: "low" as const };

    let sourceId: string;
    try {
      await client.query("BEGIN");
      ({ sourceId } = await queueCandidate(client, item, matchResult));
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const sourceRow = await pool.query(`SELECT id FROM sources WHERE id = $1`, [sourceId]);
    expect(sourceRow.rows).toHaveLength(0);
  });
});
