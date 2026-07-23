import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL, PUBLIC_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";

// Migrations 0015/0016, DESIGN.md §8/§9: internal/public separation
// enforced at the database layer via role GRANTs, not just app logic.
// "No GRANT is a REVOKE by default" in Postgres, so the interesting
// assertions here are as much about what's *absent* as what's present.
const INSUFFICIENT_PRIVILEGE = "42501";

describe("DB-level role separation (cop_public_api / cop_internal_api)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("cop_public_api", () => {
    // One pool reused across this describe block's tests (rather than a
    // fresh Pool per test) to avoid needless connection churn against
    // cop_test's shared max_connections budget; resetTestDatabase() in the
    // outer beforeEach still gives every test a clean-slate database.
    let pool: Pool;

    beforeAll(() => {
      pool = createPool(PUBLIC_API_URL);
    });

    afterAll(async () => {
      await pool?.end();
    });

    it.each(["officers", "incidents", "departments", "department_stats"])(
      "can SELECT from %s",
      async (table) => {
        await expect(pool.query(`SELECT * FROM ${table} LIMIT 1`)).resolves.toBeDefined();
      },
    );

    it.each(["review_queue", "reviewers", "reviewer_sessions", "record_revisions"])(
      "cannot SELECT from %s (permission denied)",
      async (table) => {
        await expect(pool.query(`SELECT * FROM ${table} LIMIT 1`)).rejects.toMatchObject({
          code: INSUFFICIENT_PRIVILEGE,
        });
      },
    );

    it("can INSERT into disputes (the public correction/takedown form path, migration 0016)", async () => {
      const result = await pool.query(
        `INSERT INTO disputes (officer_id, requester_name, requester_role, claim)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [SEED.officers.mariaNguyen, "Public Submitter", "subject", "Public-role insert smoke test."],
      );
      expect(result.rowCount).toBe(1);
    });

    it("cannot UPDATE disputes (only cop_internal_api resolves a dispute)", async () => {
      // Permission is checked before row matching, so this fails on grants
      // even with a WHERE clause that wouldn't match anything.
      await expect(
        pool.query(`UPDATE disputes SET status = 'resolved_no_change' WHERE id = $1`, [
          "00000000-0000-0000-0000-000000000000",
        ]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it("cannot DELETE from disputes", async () => {
      await expect(
        pool.query(`DELETE FROM disputes WHERE id = $1`, ["00000000-0000-0000-0000-000000000000"]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });
  });

  describe("cop_internal_api", () => {
    let pool: Pool;

    beforeAll(() => {
      pool = createPool(INTERNAL_API_URL);
    });

    afterAll(async () => {
      await pool?.end();
    });

    it.each(["review_queue", "reviewers", "reviewer_sessions", "record_revisions", "disputes"])(
      "can SELECT from %s",
      async (table) => {
        await expect(pool.query(`SELECT * FROM ${table} LIMIT 1`)).resolves.toBeDefined();
      },
    );

    it("can INSERT into review_queue", async () => {
      const result = await pool.query(
        `INSERT INTO review_queue (proposed_record, match_confidence, status)
         VALUES ($1::jsonb, 'low', 'pending') RETURNING id`,
        [JSON.stringify({ type: "incident_candidate", note: "internal-role insert smoke test" })],
      );
      expect(result.rowCount).toBe(1);
    });

    it("can UPDATE review_queue (e.g. resolving a review item)", async () => {
      const inserted = await pool.query(
        `INSERT INTO review_queue (proposed_record, match_confidence, status)
         VALUES ($1::jsonb, 'high', 'pending') RETURNING id`,
        [JSON.stringify({ type: "incident_candidate", note: "internal-role update smoke test" })],
      );
      const id = inserted.rows[0].id as string;

      const updated = await pool.query(
        `UPDATE review_queue SET status = 'approved', reviewer_id = $2, reviewed_at = now()
         WHERE id = $1`,
        [id, SEED.reviewers.admin],
      );
      expect(updated.rowCount).toBe(1);
    });

    it("can UPDATE disputes (resolving a dispute is internal-only)", async () => {
      const { rows } = await pool.query(`SELECT id FROM disputes LIMIT 1`);
      expect(rows.length).toBeGreaterThan(0);
      const updated = await pool.query(
        `UPDATE disputes SET status = 'resolved_no_change', resolved_by = $2, resolved_at = now()
         WHERE id = $1`,
        [rows[0].id, SEED.reviewers.admin],
      );
      expect(updated.rowCount).toBe(1);
    });

    it.each(["officers", "incidents", "departments", "disputes", "review_queue", "reviewers"])(
      "cannot DELETE from %s (no DELETE grant at all — corrections go through disputes, never row deletion)",
      async (table) => {
        await expect(
          pool.query(`DELETE FROM ${table} WHERE id = $1`, ["00000000-0000-0000-0000-000000000000"]),
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      },
    );
  });
});
