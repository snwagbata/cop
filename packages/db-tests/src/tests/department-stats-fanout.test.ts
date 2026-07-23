import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL, SUPERUSER_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";

// Migration 0013: department_stats materialized view.
//
// Regression test for the fan-out double-counting bug documented in that
// migration's own comment: joining incidents->outcomes and departments->
// officer_department_history directly in one query multiplies SUM()s when a
// department has more than one officer_department_history row, because the
// join produces one output row per (outcome, history-row) pair instead of
// per outcome. The fix pre-aggregates each metric in its own subquery
// before joining to departments. This test re-creates the exact shape that
// caused the original bug (independently of seed data, which happens to
// reproduce it too) and asserts the settlement total is not multiplied by
// the number of officer_department_history rows.
describe("department_stats materialized view: settlement fan-out regression", () => {
  let internalPool: Pool;
  let superuserPool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    internalPool = createPool(INTERNAL_API_URL);
    superuserPool = createPool(SUPERUSER_URL);
  });

  afterAll(async () => {
    await internalPool?.end();
    await superuserPool?.end();
  });

  async function refreshDepartmentStats(): Promise<void> {
    // Only the view's owner (the superuser role migrations ran as) can
    // REFRESH a materialized view — verified directly against this schema:
    // cop_internal_api only holds SELECT on department_stats (migration
    // 0015), so REFRESH must go through the superuser connection here, same
    // as db/seed/0001_synthetic_sample_data.sql does at seed time.
    await superuserPool.query("REFRESH MATERIALIZED VIEW department_stats");
  }

  it("does not double-count a settlement when the department has two officer_department_history rows", async () => {
    const settlementAmountCents = 999_900; // deliberately not round, so an accidental x2 is unmistakable (1_999_800)

    const { rows: deptRows } = await internalPool.query(
      `INSERT INTO departments (name, state, jurisdiction_type)
       VALUES ('Fan-out Regression PD (fixture)', 'CA', 'municipal') RETURNING id`,
    );
    const departmentId = deptRows[0].id as string;

    const { rows: officerRows } = await internalPool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status)
       VALUES
         ('Fixture', 'OfficerOne', $1, 'active'),
         ('Fixture', 'OfficerTwo', $1, 'active')
       RETURNING id`,
      [departmentId],
    );
    const [officerOneId, officerTwoId] = officerRows.map((r) => r.id as string);

    // Two officer_department_history rows in the SAME department — the
    // multiplier that caused the original bug. Different badge numbers so
    // this doesn't trip the 0006 exclusion constraint.
    await internalPool.query(
      `INSERT INTO officer_department_history (officer_id, department_id, badge_number, start_date, end_date)
       VALUES
         ($1, $3, 'FX-1', '2020-01-01', NULL),
         ($2, $3, 'FX-2', '2021-01-01', NULL)`,
      [officerOneId, officerTwoId, departmentId],
    );

    const { rows: incidentRows } = await internalPool.query(
      `INSERT INTO incidents (department_id, date, incident_type, short_description, status)
       VALUES ($1, '2022-01-01', 'use_of_force', 'Fixture incident for fan-out regression test.', 'sustained')
       RETURNING id`,
      [departmentId],
    );
    const incidentId = incidentRows[0].id as string;

    // Exactly ONE lawsuit_settlement outcome — the correct answer is this
    // amount, not this amount times the number of history rows above.
    await internalPool.query(
      `INSERT INTO outcomes (incident_id, outcome_type, amount_cents)
       VALUES ($1, 'lawsuit_settlement', $2)`,
      [incidentId, settlementAmountCents],
    );

    await refreshDepartmentStats();

    const { rows: statsRows } = await internalPool.query(
      `SELECT total_settlement_amount_cents, total_incident_count, sustained_complaint_count
       FROM department_stats WHERE department_id = $1`,
      [departmentId],
    );
    expect(statsRows).toHaveLength(1);
    expect(Number(statsRows[0].total_settlement_amount_cents)).toBe(settlementAmountCents);
    expect(Number(statsRows[0].total_incident_count)).toBe(1);
    expect(Number(statsRows[0].sustained_complaint_count)).toBe(1);
  });

  it("still does not double-count with three officer_department_history rows for the same department", async () => {
    // Same scenario, but with an extra history row (including a re-hire —
    // one officer with two separate stints) to make sure the fix isn't
    // coincidentally tuned to "exactly two" rows.
    const settlementAmountCents = 500_025;

    const { rows: deptRows } = await internalPool.query(
      `INSERT INTO departments (name, state, jurisdiction_type)
       VALUES ('Fan-out Regression PD Two (fixture)', 'CA', 'municipal') RETURNING id`,
    );
    const departmentId = deptRows[0].id as string;

    const { rows: officerRows } = await internalPool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status)
       VALUES
         ('Fixture', 'OfficerThree', $1, 'active'),
         ('Fixture', 'OfficerFour', $1, 'active')
       RETURNING id`,
      [departmentId],
    );
    const [officerThreeId, officerFourId] = officerRows.map((r) => r.id as string);

    await internalPool.query(
      `INSERT INTO officer_department_history (officer_id, department_id, badge_number, start_date, end_date)
       VALUES
         ($1, $3, 'FX-3', '2015-01-01', '2018-01-01'),
         ($1, $3, 'FX-3B', '2018-06-01', NULL),
         ($2, $3, 'FX-4', '2019-01-01', NULL)`,
      [officerThreeId, officerFourId, departmentId],
    );

    const { rows: incidentRows } = await internalPool.query(
      `INSERT INTO incidents (department_id, date, incident_type, short_description, status)
       VALUES ($1, '2022-06-01', 'unlawful_arrest', 'Second fixture incident for fan-out regression test.', 'sustained')
       RETURNING id`,
      [departmentId],
    );
    const incidentId = incidentRows[0].id as string;

    await internalPool.query(
      `INSERT INTO outcomes (incident_id, outcome_type, amount_cents)
       VALUES ($1, 'lawsuit_settlement', $2)`,
      [incidentId, settlementAmountCents],
    );

    await refreshDepartmentStats();

    const { rows: statsRows } = await internalPool.query(
      `SELECT total_settlement_amount_cents FROM department_stats WHERE department_id = $1`,
      [departmentId],
    );
    expect(Number(statsRows[0].total_settlement_amount_cents)).toBe(settlementAmountCents);
  });
});
