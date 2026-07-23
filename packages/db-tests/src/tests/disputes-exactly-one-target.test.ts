import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";

// Migration 0012: disputes_exactly_one_target CHECK constraint.
// Exactly one of incident_id / outcome_id / officer_id must be set per
// dispute row (DESIGN.md §3/§4/§10).
describe("disputes exactly-one-target CHECK constraint", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const baseFields = {
    requester_name: "Test Requester",
    requester_role: "attorney",
    claim: "Test claim text.",
  };

  it("rejects a dispute with two targets set (incident_id + outcome_id)", async () => {
    await expect(
      pool.query(
        `INSERT INTO disputes (incident_id, outcome_id, requester_name, requester_role, claim)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          SEED.incidents.springfieldUseOfForce,
          SEED.outcomes.springfieldLawsuitSettlement,
          baseFields.requester_name,
          baseFields.requester_role,
          baseFields.claim,
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" }); // check_violation
  });

  it("rejects a dispute with all three targets set", async () => {
    await expect(
      pool.query(
        `INSERT INTO disputes (incident_id, outcome_id, officer_id, requester_name, requester_role, claim)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          SEED.incidents.springfieldUseOfForce,
          SEED.outcomes.springfieldLawsuitSettlement,
          SEED.officers.janeDoe,
          baseFields.requester_name,
          baseFields.requester_role,
          baseFields.claim,
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a dispute with zero targets set", async () => {
    await expect(
      pool.query(
        `INSERT INTO disputes (requester_name, requester_role, claim)
         VALUES ($1, $2, $3)`,
        [baseFields.requester_name, baseFields.requester_role, baseFields.claim],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts a dispute with exactly one target set (incident_id)", async () => {
    const result = await pool.query(
      `INSERT INTO disputes (incident_id, requester_name, requester_role, claim)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [SEED.incidents.springfieldUseOfForce, baseFields.requester_name, baseFields.requester_role, baseFields.claim],
    );
    expect(result.rowCount).toBe(1);
  });

  it("accepts a dispute with exactly one target set (outcome_id)", async () => {
    const result = await pool.query(
      `INSERT INTO disputes (outcome_id, requester_name, requester_role, claim)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        SEED.outcomes.springfieldLawsuitSettlement,
        baseFields.requester_name,
        baseFields.requester_role,
        baseFields.claim,
      ],
    );
    expect(result.rowCount).toBe(1);
  });

  it("accepts a dispute with exactly one target set (officer_id)", async () => {
    const result = await pool.query(
      `INSERT INTO disputes (officer_id, requester_name, requester_role, claim)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [SEED.officers.janeDoe, baseFields.requester_name, baseFields.requester_role, baseFields.claim],
    );
    expect(result.rowCount).toBe(1);
  });
});
