import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";

// Migration 0006: officer_department_history_no_badge_overlap.
// EXCLUDE USING gist (department_id WITH =, badge_number WITH =, period WITH &&)
// stops the same (department, badge_number) pair from ever having two
// history rows with overlapping active date ranges — the structural guard
// against silent badge-reuse collisions (DESIGN.md §6).
describe("officer_department_history badge-reuse exclusion constraint", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("rejects a new row that reuses a department+badge with an overlapping active range", async () => {
    // Seed baseline: officer janeDoe holds badge '101' at Springfield with
    // period [2016-04-01, infinity) — still current (end_date IS NULL).
    // Insert a *different* officer into the same department under the same
    // badge number, with a start date that falls inside that still-open
    // range. This must be rejected: it would mean two officers holding the
    // same badge in the same department at the same time.
    await expect(
      pool.query(
        `INSERT INTO officer_department_history
           (officer_id, department_id, badge_number, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [SEED.officers.mariaNguyen, SEED.departments.springfield, "101", "2020-01-01", null],
      ),
    ).rejects.toMatchObject({ code: "23P01" }); // exclusion_violation
  });

  it("rejects an overlap even when the new row's range is a strict subset of the existing one", async () => {
    // Belt-and-suspenders on the && (overlap) semantics: a fully-contained
    // sub-range should still collide, not slip through on some boundary
    // technicality.
    await expect(
      pool.query(
        `INSERT INTO officer_department_history
           (officer_id, department_id, badge_number, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [SEED.officers.mariaNguyen, SEED.departments.springfield, "101", "2017-01-01", "2017-06-01"],
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("allows a non-overlapping range for the same badge after the prior tenure ended", async () => {
    // Seed baseline: officer robertSmith held badge '55' at Shelbyville over
    // [2015-01-01, 2019-05-31) (end_date '2019-05-31', so the generated
    // period's upper bound is exclusive at that date). Reassigning badge
    // '55' to a new officer at Shelbyville starting the same day the old
    // tenure ended is the textbook non-overlapping case and must succeed —
    // this is the case a too-strict constraint (e.g. one that didn't use a
    // half-open range, or compared on department alone) would wrongly reject.
    const result = await pool.query(
      `INSERT INTO officer_department_history
         (officer_id, department_id, badge_number, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [SEED.officers.mariaNguyen, SEED.departments.shelbyville, "55", "2019-05-31", null],
    );
    expect(result.rowCount).toBe(1);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM officer_department_history
       WHERE department_id = $1 AND badge_number = $2`,
      [SEED.departments.shelbyville, "55"],
    );
    expect(rows[0].count).toBe(2); // the original robertSmith row + the new one
  });

  it("allows overlapping ranges for the same badge number across different departments", async () => {
    // The exclusion constraint is keyed on (department_id, badge_number,
    // period) together — the same badge number active at the same time in
    // two *different* departments is expected and must not be rejected.
    const result = await pool.query(
      `INSERT INTO officer_department_history
         (officer_id, department_id, badge_number, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [SEED.officers.mariaNguyen, SEED.departments.shelbyville, "101", "2020-01-01", null],
    );
    expect(result.rowCount).toBe(1);
  });
});
