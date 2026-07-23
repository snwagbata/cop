import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";

// Lighter sanity check: after a fresh reseed, the row counts and the
// "wandering officer" structural shape documented by
// db/seed/0001_synthetic_sample_data.sql should be exactly what that file's
// own comments describe. Read-only, so a single beforeAll reset (not
// beforeEach) is enough per db/TESTING.md's convention. Uses the internal
// role (not public) because this check includes review_queue, which
// cop_public_api has no grants on at all (migration 0015) — see the
// role-grants suite for that boundary itself.
describe("seed data integrity (db/seed/0001_synthetic_sample_data.sql baseline)", () => {
  let pool: Pool;

  beforeAll(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it.each([
    ["departments", 2],
    ["officers", 3],
    ["incidents", 2],
    ["outcomes", 3],
    ["sources", 3],
    ["citations", 5],
  ])("has exactly %s rows in %s", async (table, expectedCount) => {
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    expect(rows[0].count).toBe(expectedCount);
  });

  it("has exactly 1 pending review_queue item", async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM review_queue WHERE status = 'pending'`,
    );
    expect(rows[0].count).toBe(1);
  });

  it("has exactly 1 open dispute", async () => {
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM disputes WHERE status = 'open'`);
    expect(rows[0].count).toBe(1);
  });

  it("has exactly 2 officer_department_history rows for the wandering officer (Robert Smith)", async () => {
    const { rows } = await pool.query(
      `SELECT department_id, badge_number FROM officer_department_history
       WHERE officer_id = $1 ORDER BY start_date`,
      [SEED.officers.robertSmith],
    );
    expect(rows).toHaveLength(2);

    const [first, second] = rows;
    // Different departments...
    expect(first.department_id).not.toBe(second.department_id);
    expect([first.department_id, second.department_id].sort()).toEqual(
      [SEED.departments.shelbyville, SEED.departments.springfield].sort(),
    );
    // ...and different badge numbers, which is exactly why cross-department
    // matching can't rely on badge_number alone (DESIGN.md §6) — POST
    // certification ID is the real match key.
    expect(first.badge_number).not.toBe(second.badge_number);
  });

  it("Robert Smith's officer row carries the POST certification ID used for cross-department matching", async () => {
    const { rows } = await pool.query(`SELECT post_certification_id FROM officers WHERE id = $1`, [
      SEED.officers.robertSmith,
    ]);
    expect(rows[0].post_certification_id).toBe("CA-POST-000222");
  });
});
