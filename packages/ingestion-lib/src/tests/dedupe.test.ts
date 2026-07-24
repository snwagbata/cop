import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { hasBeenQueued } from "../dedupe.js";

describe("hasBeenQueued", () => {
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

  it("returns true for a source_type/external_ref pair that's already been queued", async () => {
    await pool.query(
      `INSERT INTO sources (source_type, url, reliability_tier, external_ref)
       VALUES ('court_doc', 'https://example.gov/docket/123', 'tier1_primary_legal_doc', 'docket-123')`,
    );

    await expect(hasBeenQueued(pool, "court_doc", "docket-123")).resolves.toBe(true);
  });

  it("returns false for an external_ref that hasn't been seen", async () => {
    await expect(hasBeenQueued(pool, "court_doc", "docket-does-not-exist")).resolves.toBe(false);
  });

  it("is scoped per source_type -- the same external_ref string under a different source_type doesn't count", async () => {
    await pool.query(
      `INSERT INTO sources (source_type, url, reliability_tier, external_ref)
       VALUES ('court_doc', 'https://example.gov/docket/999', 'tier1_primary_legal_doc', 'shared-ref')`,
    );

    await expect(hasBeenQueued(pool, "court_doc", "shared-ref")).resolves.toBe(true);
    await expect(hasBeenQueued(pool, "decertification_registry", "shared-ref")).resolves.toBe(false);
  });
});
