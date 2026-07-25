import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { runNycCcrbPipeline } from "../../src/nyc-ccrb/run.js";
import type { NycCcrbAllegation } from "../../src/nyc-ccrb/client.js";

const ENV = {};

function allegation(overrides: Partial<NycCcrbAllegation> = {}): NycCcrbAllegation {
  return {
    complaintId: "201806447",
    complaintOfficerNumber: "1",
    allegationRecordIdentity: "240280",
    fadoType: "Force",
    allegation: "Physical force",
    ccrbDisposition: "Substantiated (Charges)",
    nypdDisposition: "APU Guilty",
    officerFirstName: "Alfred",
    officerLastName: "Hernandez",
    shieldNo: "05046",
    ...overrides,
  };
}

async function insertConfig(pool: Pool, config: { departmentName: string }, enabled = true): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', $1, $2) RETURNING id`,
    [enabled, JSON.stringify(config)],
  );
  return result.rows[0].id;
}

describe("runNycCcrbPipeline", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("takes a clean candidate end-to-end into review_queue, matching an existing NYPD officer", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    // Test-local officer row (deliberately not in seed data -- per the
    // design doc, real NYPD officers are meant to arrive via reviewer
    // approval, not seed data; this row exists only so this one test can
    // exercise the 'medium'-confidence match path).
    const officerResult = await pool.query<{ id: string }>(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status)
       VALUES ('Alfred', 'Hernandez', $1, 'active') RETURNING id`,
      [SEED.departments.nyc.id],
    );
    const officerId = officerResult.rows[0].id;

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    expect(fetchNycCcrbAllegations).toHaveBeenCalledWith({ appToken: undefined });

    const sourceRows = await pool.query(
      `SELECT source_type, reliability_tier, external_ref FROM sources WHERE external_ref = '201806447:240280'`,
    );
    expect(sourceRows.rows).toHaveLength(1);
    expect(sourceRows.rows[0]).toMatchObject({
      source_type: "official_dataset",
      reliability_tier: "tier2_official_dataset",
      external_ref: "201806447:240280",
    });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence, rq.status
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].status).toBe("pending");
    expect(reviewQueueRows.rows[0].match_confidence).toBe("medium");
    expect(reviewQueueRows.rows[0].proposed_record).toMatchObject({
      type: "incident_candidate",
      officerId,
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
    });

    const runRows = await pool.query(
      `SELECT source_type, items_fetched, items_queued, items_deduped, error, finished_at FROM ingestion_runs`,
    );
    expect(runRows.rows).toHaveLength(1);
    expect(runRows.rows[0]).toMatchObject({
      source_type: "nyc_ccrb",
      items_fetched: 1,
      items_queued: 1,
      items_deduped: 0,
      error: null,
    });
    expect(runRows.rows[0].finished_at).not.toBeNull();
  });

  it("skips an allegation already queued from a prior run (dedup via external_ref)", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const priorSource = await pool.query<{ id: string }>(
      `INSERT INTO sources (source_type, reliability_tier, external_ref)
       VALUES ('official_dataset', 'tier2_official_dataset', '201806447:240280')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status)
       VALUES ($1, $2, 'low', 'pending')`,
      [
        JSON.stringify({
          type: "incident_candidate",
          departmentName: SEED.departments.nyc.name,
          incidentType: "use_of_force",
          shortDescription: "Pre-existing candidate from a prior run.",
        }),
        priorSource.rows[0].id,
      ],
    );

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const sourceRows = await pool.query(`SELECT id FROM sources WHERE external_ref = '201806447:240280'`);
    expect(sourceRows.rows).toHaveLength(1); // still just the one from setup

    const runRows = await pool.query(`SELECT items_fetched, items_queued, items_deduped FROM ingestion_runs`);
    expect(runRows.rows[0]).toMatchObject({ items_fetched: 1, items_queued: 0, items_deduped: 1 });
  });

  it("queues two allegations sharing the same complaint_id and complaint_officer_number but different allegationRecordIdentity as separate review_queue candidates, not deduped against each other", async () => {
    // End-to-end regression test for the dedup-key bug: complaint_id +
    // complaint_officer_number alone is NOT unique -- a single
    // complaint+officer pair can have multiple distinct allegation rows
    // (e.g. "Force" and "Abuse of Authority" against the same officer on
    // the same complaint). Both must reach review_queue, not just the
    // first.
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([
      allegation({ allegationRecordIdentity: "240282", fadoType: "Force", allegation: "Physical force" }),
      allegation({ allegationRecordIdentity: "240281", fadoType: "Abuse of Authority", allegation: "Failure to provide RTKA card" }),
    ]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const sourceRows = await pool.query(
      `SELECT external_ref FROM sources WHERE external_ref IN ('201806447:240282', '201806447:240281')`,
    );
    expect(sourceRows.rows).toHaveLength(2);

    const reviewQueueRows = await pool.query(
      `SELECT rq.id FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref IN ('201806447:240282', '201806447:240281')`,
    );
    expect(reviewQueueRows.rows).toHaveLength(2);

    const runRows = await pool.query(`SELECT items_fetched, items_queued, items_deduped FROM ingestion_runs`);
    expect(runRows.rows[0]).toMatchObject({ items_fetched: 2, items_queued: 2, items_deduped: 0 });
  });

  it("queues a low-confidence candidate with a note when no shield number is on file", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ shieldNo: null })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].match_confidence).toBe("low"); // no officers table row exists to match against
    expect(reviewQueueRows.rows[0].proposed_record.note).toMatch(/no shield number/i);
  });

  it("queues a low-confidence candidate with a different note when no officer name was returned at all", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi
      .fn()
      .mockResolvedValue([allegation({ officerFirstName: null, officerLastName: null, shieldNo: null })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record FROM review_queue rq JOIN sources s ON s.id = rq.source_id WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows[0].proposed_record.note).toMatch(/did not return an officer name/i);
    expect(reviewQueueRows.rows[0].proposed_record.officerName).toBeUndefined();
  });

  it("isolates one config row's failure -- other rows still run", async () => {
    const failingConfigId = await insertConfig(pool, { departmentName: "Some Other Department" });
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    let callCount = 0;
    const fetchNycCcrbAllegations = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("NYC CCRB request failed: 500 Internal Server Error");
      }
      return [allegation({ complaintId: "999", complaintOfficerNumber: "1" })];
    });

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    expect(fetchNycCcrbAllegations).toHaveBeenCalledTimes(2);

    const failedRun = await pool.query(
      `SELECT items_fetched, error, finished_at FROM ingestion_runs ORDER BY started_at ASC LIMIT 1`,
    );
    expect(failedRun.rows[0].error).toMatch(/500 Internal Server Error/);
    expect(failedRun.rows[0].finished_at).not.toBeNull();

    const succeededRun = await pool.query(
      `SELECT items_fetched, items_queued, error FROM ingestion_runs ORDER BY started_at ASC OFFSET 1 LIMIT 1`,
    );
    expect(succeededRun.rows[0]).toMatchObject({ items_fetched: 1, items_queued: 1, error: null });

    const configRows = await pool.query(`SELECT last_run_at FROM ingestion_configs WHERE id = $1`, [failingConfigId]);
    expect(configRows.rows[0].last_run_at).not.toBeNull();
  });

  it("skips disabled config rows entirely", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name }, false);

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    expect(fetchNycCcrbAllegations).not.toHaveBeenCalled();
    const runRows = await pool.query(`SELECT id FROM ingestion_runs`);
    expect(runRows.rows).toHaveLength(0);
  });

  it("skips a config row whose config JSON doesn't match the expected shape, without crashing the whole pipeline", async () => {
    await pool.query(`INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', true, $1)`, [
      JSON.stringify({ notTheRightShape: true }),
    ]);
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    expect(fetchNycCcrbAllegations).toHaveBeenCalledTimes(1);
    const runRows = await pool.query(`SELECT id FROM ingestion_runs`);
    expect(runRows.rows).toHaveLength(1);
  });
});
