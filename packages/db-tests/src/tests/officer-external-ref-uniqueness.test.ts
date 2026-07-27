import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";

// Migration 0020: officers.external_officer_ref is the stable cross-run
// identity key ingestion pipelines use to avoid creating duplicate officer
// rows for the same real officer (e.g. "nyc_ccrb:<tax_id>"). The partial
// unique index (WHERE external_officer_ref IS NOT NULL) must reject a
// second officer claiming the same ref, while allowing any number of
// officers with no ref at all (NULL, from manual creation or other
// sources with no stable id).
const UNIQUE_VIOLATION = "23505";

describe("officers.external_officer_ref uniqueness (migration 0020)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool(INTERNAL_API_URL);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("rejects a second officer with the same non-null external_officer_ref", async () => {
    await pool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
       VALUES ('First', 'Officer', $1, 'active', 'nyc_ccrb:12345')`,
      [SEED.departments.springfield],
    );

    await expect(
      pool.query(
        `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
         VALUES ('Second', 'Officer', $1, 'active', 'nyc_ccrb:12345')`,
        [SEED.departments.springfield],
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it("allows any number of officers with a NULL external_officer_ref", async () => {
    await pool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status)
       VALUES ('First', 'NoRef', $1, 'active')`,
      [SEED.departments.springfield],
    );
    const second = await pool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status)
       VALUES ('Second', 'NoRef', $1, 'active') RETURNING id`,
      [SEED.departments.springfield],
    );
    expect(second.rowCount).toBe(1);
  });
});
