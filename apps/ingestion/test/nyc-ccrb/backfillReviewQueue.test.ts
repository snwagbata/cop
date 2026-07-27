import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { runNycCcrbReviewQueueBackfill } from "../../src/nyc-ccrb/backfillReviewQueue.js";
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
    taxId: "942643",
    officerRank: "Police Officer",
    officerActive: true,
    incidentDate: "2018-01-05",
    ...overrides,
  };
}

async function insertConfig(pool: Pool, config: { departmentName: string }): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', true, $1) RETURNING id`,
    [JSON.stringify(config)],
  );
  return result.rows[0].id;
}

async function insertPendingQueueItem(
  pool: Pool,
  externalRef: string,
  proposedRecord: Record<string, unknown>,
): Promise<string> {
  const source = await pool.query<{ id: string }>(
    `INSERT INTO sources (source_type, reliability_tier, external_ref) VALUES ('official_dataset', 'tier2_official_dataset', $1) RETURNING id`,
    [externalRef],
  );
  const queueItem = await pool.query<{ id: string }>(
    `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status) VALUES ($1, $2, 'low', 'pending') RETURNING id`,
    [JSON.stringify(proposedRecord), source.rows[0].id],
  );
  return queueItem.rows[0].id;
}

describe("runNycCcrbReviewQueueBackfill", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("resolves a pending item's officerId when the officer already exists via external_officer_ref, stripping officerName", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const officerRow = await pool.query<{ id: string }>(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
       VALUES ('Alfred', 'Hernandez', $1, 'active', 'nyc_ccrb:942643') RETURNING id`,
      [SEED.departments.nyc.id],
    );
    const queueItemId = await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerName: "Alfred Hernandez",
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "CCRB complaint: Force - Physical force.",
    });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results).toEqual([
      { departmentName: SEED.departments.nyc.name, allegationsChecked: 1, reviewQueueRowsUpdated: 1 },
    ]);
    // Must widen past the client's 30-day default -- this script runs some
    // unknown number of days after the original queueing run, so it needs a
    // window generous enough to still cover that run's complaints.
    expect(fetchNycCcrbAllegations).toHaveBeenCalledWith({ appToken: undefined, sinceDays: 120 });

    const updated = await pool.query(`SELECT proposed_record, match_confidence FROM review_queue WHERE id = $1`, [
      queueItemId,
    ]);
    expect(updated.rows[0].match_confidence).toBe("high");
    expect(updated.rows[0].proposed_record.officerId).toBe(officerRow.rows[0].id);
    expect(updated.rows[0].proposed_record.officerName).toBeUndefined();
  });

  it("leaves a pending item untouched when no officer resolves for it yet", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const queueItemId = await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerName: "Alfred Hernandez",
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "CCRB complaint: Force - Physical force.",
    });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]); // no officer row exists to match
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(0);
    const untouched = await pool.query(`SELECT proposed_record, match_confidence FROM review_queue WHERE id = $1`, [
      queueItemId,
    ]);
    expect(untouched.rows[0].match_confidence).toBe("low");
    expect(untouched.rows[0].proposed_record.officerName).toBe("Alfred Hernandez");
  });

  it("does not touch a review_queue row that's already been approved or rejected, even if an officer now resolves for it", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    await pool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
       VALUES ('Alfred', 'Hernandez', $1, 'active', 'nyc_ccrb:942643')`,
      [SEED.departments.nyc.id],
    );
    const source = await pool.query<{ id: string }>(
      `INSERT INTO sources (source_type, reliability_tier, external_ref) VALUES ('official_dataset', 'tier2_official_dataset', '201806447:240280') RETURNING id`,
    );
    const rejected = await pool.query<{ id: string }>(
      `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status) VALUES ($1, $2, 'low', 'rejected') RETURNING id`,
      [JSON.stringify({ type: "incident_candidate", officerName: "Alfred Hernandez", departmentName: SEED.departments.nyc.name, incidentType: "use_of_force", shortDescription: "x" }), source.rows[0].id],
    );

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(0);
    const stillRejected = await pool.query(`SELECT status, proposed_record FROM review_queue WHERE id = $1`, [
      rejected.rows[0].id,
    ]);
    expect(stillRejected.rows[0].status).toBe("rejected");
    expect(stillRejected.rows[0].proposed_record.officerName).toBe("Alfred Hernandez"); // untouched
  });

  it("skips an allegation with no taxId", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerName: "Alfred Hernandez",
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "x",
    });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ taxId: null })]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(0);
  });
});
