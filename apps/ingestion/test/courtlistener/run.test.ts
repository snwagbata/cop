import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { runCourtListenerPipeline } from "../../src/courtlistener/run.js";
import type { CourtListenerDocket } from "../../src/courtlistener/client.js";
import type { ExtractedOfficer } from "../../src/courtlistener/extract.js";

/**
 * Full-pipeline integration test (per this task's brief): real Postgres
 * (apps/ingestion's own cop_test_courtlistener database, db/TESTING.md's
 * isolated-database convention), with client.ts and extract.ts mocked via
 * dependency injection -- no real CourtListener or Anthropic API call in
 * this suite.
 */

const ENV = { courtListenerApiKey: "test-cl-key", anthropicApiKey: "test-anthropic-key" };

function docket(overrides: Partial<CourtListenerDocket> = {}): CourtListenerDocket {
  return {
    docketId: "1001",
    caseName: "Doe v. Springfield",
    court: "cand",
    dateFiled: "2024-03-01",
    docketUrl: "https://www.courtlistener.com/docket/1001/doe-v-springfield/",
    partyText: "Jane Doe v. City of Springfield; Officer Jane Doe",
    ...overrides,
  };
}

async function insertConfig(
  pool: Pool,
  config: { keyword: string; court?: string; departmentName: string },
  enabled = true,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('courtlistener', $1, $2) RETURNING id`,
    [enabled, JSON.stringify(config)],
  );
  return result.rows[0].id;
}

describe("runCourtListenerPipeline", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("takes a clean candidate end-to-end into review_queue, with a correct ingestion_runs row", async () => {
    await insertConfig(pool, {
      keyword: "excessive force",
      departmentName: SEED.departments.springfield.name,
    });

    const searchCourtListener = vi.fn().mockResolvedValue([docket()]);
    const extractOfficerFromPartyText = vi
      .fn<[], Promise<ExtractedOfficer>>()
      .mockResolvedValue({ officerName: SEED.officers.janeDoe.name, confidence: "clear" });

    await runCourtListenerPipeline(pool, ENV, { searchCourtListener, extractOfficerFromPartyText });

    expect(searchCourtListener).toHaveBeenCalledWith(ENV.courtListenerApiKey, {
      keyword: "excessive force",
      court: undefined,
    });

    const sourceRows = await pool.query(
      `SELECT source_type, url, reliability_tier, external_ref FROM sources WHERE external_ref = '1001'`,
    );
    expect(sourceRows.rows).toHaveLength(1);
    expect(sourceRows.rows[0]).toMatchObject({
      source_type: "court_doc",
      reliability_tier: "tier1_primary_legal_doc",
      external_ref: "1001",
    });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence, rq.status
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '1001'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].status).toBe("pending");
    // matchOfficer (packages/ingestion-lib/src/match.ts) only ever returns
    // 'high' via a postCertificationId match -- this pipeline doesn't have
    // one (CourtListener dockets don't carry a POST id), so a confident
    // name+department match tops out at 'medium', per DESIGN.md §6's rule
    // that no pipeline may claim 'high' off a fuzzy name match alone.
    expect(reviewQueueRows.rows[0].match_confidence).toBe("medium");
    expect(reviewQueueRows.rows[0].proposed_record).toMatchObject({
      type: "incident_candidate",
      officerId: SEED.officers.janeDoe.id,
      departmentName: SEED.departments.springfield.name,
    });

    const runRows = await pool.query(
      `SELECT source_type, items_fetched, items_queued, items_deduped, error, finished_at FROM ingestion_runs`,
    );
    expect(runRows.rows).toHaveLength(1);
    expect(runRows.rows[0]).toMatchObject({
      source_type: "courtlistener",
      items_fetched: 1,
      items_queued: 1,
      items_deduped: 0,
      error: null,
    });
    expect(runRows.rows[0].finished_at).not.toBeNull();

    const configRows = await pool.query(`SELECT last_run_at FROM ingestion_configs`);
    expect(configRows.rows[0].last_run_at).not.toBeNull();
  });

  it("skips a docket already queued from a prior run (dedup via external_ref)", async () => {
    await insertConfig(pool, {
      keyword: "excessive force",
      departmentName: SEED.departments.springfield.name,
    });

    // Simulate a prior run having already queued this exact docket.
    const priorSource = await pool.query<{ id: string }>(
      `INSERT INTO sources (source_type, url, reliability_tier, external_ref)
       VALUES ('court_doc', 'https://example.gov/docket/1001', 'tier1_primary_legal_doc', '1001')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status)
       VALUES ($1, $2, 'low', 'pending')`,
      [
        JSON.stringify({
          type: "incident_candidate",
          departmentName: SEED.departments.springfield.name,
          incidentType: "other",
          shortDescription: "Pre-existing candidate from a prior run.",
        }),
        priorSource.rows[0].id,
      ],
    );

    const searchCourtListener = vi.fn().mockResolvedValue([docket({ docketId: "1001" })]);
    const extractOfficerFromPartyText = vi
      .fn<[], Promise<ExtractedOfficer>>()
      .mockResolvedValue({ officerName: SEED.officers.janeDoe.name, confidence: "clear" });

    await runCourtListenerPipeline(pool, ENV, { searchCourtListener, extractOfficerFromPartyText });

    // extractOfficerFromPartyText should never even be called for an
    // already-queued docket -- dedup happens before the LLM step.
    expect(extractOfficerFromPartyText).not.toHaveBeenCalled();

    const sourceRows = await pool.query(`SELECT id FROM sources WHERE external_ref = '1001'`);
    expect(sourceRows.rows).toHaveLength(1); // still just the one from setup, no duplicate insert

    const runRows = await pool.query(
      `SELECT items_fetched, items_queued, items_deduped FROM ingestion_runs`,
    );
    expect(runRows.rows[0]).toMatchObject({ items_fetched: 1, items_queued: 0, items_deduped: 1 });
  });

  it("never queues a candidate when extraction confidence is 'none'", async () => {
    await insertConfig(pool, {
      keyword: "excessive force",
      departmentName: SEED.departments.springfield.name,
    });

    const searchCourtListener = vi.fn().mockResolvedValue([docket({ docketId: "2002" })]);
    const extractOfficerFromPartyText = vi
      .fn<[], Promise<ExtractedOfficer>>()
      .mockResolvedValue({ officerName: null, confidence: "none" });

    await runCourtListenerPipeline(pool, ENV, { searchCourtListener, extractOfficerFromPartyText });

    const sourceRows = await pool.query(`SELECT id FROM sources WHERE external_ref = '2002'`);
    expect(sourceRows.rows).toHaveLength(0);

    const runRows = await pool.query(`SELECT items_fetched, items_queued, items_deduped FROM ingestion_runs`);
    expect(runRows.rows[0]).toMatchObject({ items_fetched: 1, items_queued: 0, items_deduped: 0 });
  });

  it("queues an ambiguous-confidence candidate with a note flagging it for review", async () => {
    await insertConfig(pool, {
      keyword: "excessive force",
      departmentName: SEED.departments.springfield.name,
    });

    const searchCourtListener = vi.fn().mockResolvedValue([docket({ docketId: "3003" })]);
    const extractOfficerFromPartyText = vi
      .fn<[], Promise<ExtractedOfficer>>()
      .mockResolvedValue({ officerName: "Some Unmatched Person", confidence: "ambiguous" });

    await runCourtListenerPipeline(pool, ENV, { searchCourtListener, extractOfficerFromPartyText });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '3003'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].proposed_record.note).toMatch(/ambiguous/i);
  });

  it("isolates one config row's failure -- other rows still run, and the failure lands in its own ingestion_runs row", async () => {
    const failingConfigId = await insertConfig(pool, {
      keyword: "will fail",
      departmentName: SEED.departments.springfield.name,
    });
    await insertConfig(pool, {
      keyword: "will succeed",
      departmentName: SEED.departments.shelbyville.name,
    });

    const searchCourtListener = vi.fn().mockImplementation(async (_apiKey: string, query: { keyword: string }) => {
      if (query.keyword === "will fail") {
        throw new Error("CourtListener search request failed: 500 Internal Server Error");
      }
      return [docket({ docketId: "4004" })];
    });
    const extractOfficerFromPartyText = vi
      .fn<[], Promise<ExtractedOfficer>>()
      .mockResolvedValue({ officerName: SEED.officers.mariaNguyen.name, confidence: "clear" });

    await runCourtListenerPipeline(pool, ENV, { searchCourtListener, extractOfficerFromPartyText });

    expect(searchCourtListener).toHaveBeenCalledTimes(2);

    // The failing row's run recorded the error and finished (not left stuck).
    const failedRun = await pool.query(
      `SELECT items_fetched, items_queued, error, finished_at FROM ingestion_runs ORDER BY started_at ASC LIMIT 1`,
    );
    expect(failedRun.rows[0].error).toMatch(/500 Internal Server Error/);
    expect(failedRun.rows[0].items_fetched).toBe(0);
    expect(failedRun.rows[0].finished_at).not.toBeNull();

    // The succeeding row still ran to completion and queued its candidate.
    const succeededRun = await pool.query(
      `SELECT items_fetched, items_queued, error FROM ingestion_runs ORDER BY started_at ASC OFFSET 1 LIMIT 1`,
    );
    expect(succeededRun.rows[0]).toMatchObject({ items_fetched: 1, items_queued: 1, error: null });

    const sourceRows = await pool.query(`SELECT id FROM sources WHERE external_ref = '4004'`);
    expect(sourceRows.rows).toHaveLength(1);

    // Both config rows' last_run_at should be set, including the failing one.
    const configRows = await pool.query(`SELECT id, last_run_at FROM ingestion_configs WHERE id = $1`, [
      failingConfigId,
    ]);
    expect(configRows.rows[0].last_run_at).not.toBeNull();
  });

  it("skips disabled config rows entirely", async () => {
    await insertConfig(pool, { keyword: "should not run", departmentName: SEED.departments.springfield.name }, false);

    const searchCourtListener = vi.fn().mockResolvedValue([docket()]);
    const extractOfficerFromPartyText = vi
      .fn<[], Promise<ExtractedOfficer>>()
      .mockResolvedValue({ officerName: null, confidence: "none" });

    await runCourtListenerPipeline(pool, ENV, { searchCourtListener, extractOfficerFromPartyText });

    expect(searchCourtListener).not.toHaveBeenCalled();
    const runRows = await pool.query(`SELECT id FROM ingestion_runs`);
    expect(runRows.rows).toHaveLength(0);
  });

  it("skips a config row whose config JSON doesn't match the expected shape, without crashing the whole pipeline", async () => {
    await pool.query(
      `INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('courtlistener', true, $1)`,
      [JSON.stringify({ notTheRightShape: true })],
    );
    await insertConfig(pool, { keyword: "will succeed", departmentName: SEED.departments.shelbyville.name });

    const searchCourtListener = vi.fn().mockResolvedValue([docket({ docketId: "5005" })]);
    const extractOfficerFromPartyText = vi
      .fn<[], Promise<ExtractedOfficer>>()
      .mockResolvedValue({ officerName: SEED.officers.mariaNguyen.name, confidence: "clear" });

    await runCourtListenerPipeline(pool, ENV, { searchCourtListener, extractOfficerFromPartyText });

    // Only the well-formed row triggered a fetch/run.
    expect(searchCourtListener).toHaveBeenCalledTimes(1);
    const runRows = await pool.query(`SELECT id FROM ingestion_runs`);
    expect(runRows.rows).toHaveLength(1);
  });
});
