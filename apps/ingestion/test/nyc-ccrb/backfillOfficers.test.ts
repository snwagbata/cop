import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { runNycCcrbOfficerBulkImport } from "../../src/nyc-ccrb/backfillOfficers.js";
import type { NycCcrbOfficerRosterEntry } from "../../src/nyc-ccrb/client.js";

const ENV = {};

function officer(overrides: Partial<NycCcrbOfficerRosterEntry> = {}): NycCcrbOfficerRosterEntry {
  return {
    taxId: "111111",
    firstName: "Pat",
    lastName: "Rivera",
    badgeNumber: "1000",
    rank: "Sergeant",
    active: true,
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

describe("runNycCcrbOfficerBulkImport", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("imports officers with correct field mapping, including employment_status derived from active", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([
      officer({ taxId: "1", active: true }),
      officer({ taxId: "2", firstName: "Chris", lastName: "Dengel", active: false }),
    ]);

    const results = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });

    expect(results).toEqual([
      { configId: SEED.departments.nyc.name, departmentName: SEED.departments.nyc.name, totalFetched: 2, totalImported: 2 },
    ]);

    const rows = await pool.query(
      `SELECT first_name, last_name, badge_number, rank, employment_status, external_officer_ref, department_id
         FROM officers WHERE external_officer_ref IS NOT NULL ORDER BY external_officer_ref`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      first_name: "Pat",
      last_name: "Rivera",
      badge_number: "1000",
      rank: "Sergeant",
      employment_status: "active",
      external_officer_ref: "nyc_ccrb:1",
      department_id: SEED.departments.nyc.id,
    });
    expect(rows.rows[1]).toMatchObject({
      first_name: "Chris",
      last_name: "Dengel",
      employment_status: "inactive",
      external_officer_ref: "nyc_ccrb:2",
    });
  });

  it("writes a record_revisions row for each newly-created officer, changed_by NULL", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([officer({ taxId: "1" })]);

    await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });

    const officerRow = await pool.query(`SELECT id FROM officers WHERE external_officer_ref = 'nyc_ccrb:1'`);
    const revisions = await pool.query(
      `SELECT change_type, changed_by, diff FROM record_revisions WHERE record_type = 'officer' AND record_id = $1`,
      [officerRow.rows[0].id],
    );
    expect(revisions.rows).toHaveLength(1);
    expect(revisions.rows[0].change_type).toBe("create");
    expect(revisions.rows[0].changed_by).toBeNull();
    expect(revisions.rows[0].diff).toMatchObject({ source: "nyc_ccrb_officer_bulk_import", externalOfficerRef: "nyc_ccrb:1" });
  });

  it("is idempotent -- re-running does not create duplicate officers", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([officer({ taxId: "1" })]);

    const first = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });
    expect(first[0].totalImported).toBe(1);

    const second = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });
    expect(second[0].totalImported).toBe(0); // already present, skipped via ON CONFLICT DO NOTHING

    const count = await pool.query(`SELECT count(*) FROM officers WHERE external_officer_ref = 'nyc_ccrb:1'`);
    expect(count.rows[0].count).toBe("1");
  });

  it("batches across multiple chunks correctly", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const officers = Array.from({ length: 7 }, (_, i) => officer({ taxId: String(i) }));
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue(officers);

    const results = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers }, 3);

    expect(results[0].totalImported).toBe(7);
    const count = await pool.query(`SELECT count(*) FROM officers WHERE external_officer_ref LIKE 'nyc_ccrb:%'`);
    expect(count.rows[0].count).toBe("7");
  });

  it("skips a config row whose config JSON doesn't match the expected shape", async () => {
    await pool.query(`INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', true, $1)`, [
      JSON.stringify({ notTheRightShape: true }),
    ]);
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([]);

    const results = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });
    expect(results).toEqual([]);
    expect(fetchAllNycCcrbOfficers).not.toHaveBeenCalled();
  });

  it("throws a clear error when the config's departmentName doesn't resolve to a real department", async () => {
    await insertConfig(pool, { departmentName: "Nonexistent Department" });
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([]);

    await expect(runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers })).rejects.toThrow(/No department found/);
  });
});
