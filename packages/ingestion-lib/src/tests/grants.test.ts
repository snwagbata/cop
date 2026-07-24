import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL, PUBLIC_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";

// Migration 0019: cop_internal_api needs SELECT/INSERT/UPDATE on the two new
// tables (every pipeline script connects as cop_internal_api, per
// INGESTION_DESIGN.md §2 -- "same role the admin API uses"), and this repo
// has a documented history of exactly this kind of grant being missed (see
// 0016, 0018's own comment blocks). Verified here against real
// role-restricted connections, not just the superuser used to run the
// migration itself.
const INSUFFICIENT_PRIVILEGE = "42501";

describe("cop_internal_api / cop_public_api grants on ingestion_runs, ingestion_configs (migration 0019)", () => {
  let internalPool: Pool;
  let publicPool: Pool;

  beforeAll(() => {
    internalPool = createPool(INTERNAL_API_URL);
    publicPool = createPool(PUBLIC_API_URL);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await internalPool?.end();
    await publicPool?.end();
  });

  it("cop_internal_api can INSERT and SELECT on ingestion_runs", async () => {
    const inserted = await internalPool.query(
      `INSERT INTO ingestion_runs (source_type, started_at) VALUES ('court_doc', now()) RETURNING id`,
    );
    expect(inserted.rowCount).toBe(1);

    const selected = await internalPool.query(`SELECT * FROM ingestion_runs WHERE id = $1`, [
      inserted.rows[0].id,
    ]);
    expect(selected.rowCount).toBe(1);
  });

  it("cop_internal_api can UPDATE ingestion_runs", async () => {
    const inserted = await internalPool.query(
      `INSERT INTO ingestion_runs (source_type, started_at) VALUES ('court_doc', now()) RETURNING id`,
    );
    const updated = await internalPool.query(
      `UPDATE ingestion_runs SET finished_at = now(), items_fetched = 5 WHERE id = $1`,
      [inserted.rows[0].id],
    );
    expect(updated.rowCount).toBe(1);
  });

  it("cop_internal_api can INSERT, SELECT, and UPDATE on ingestion_configs", async () => {
    const inserted = await internalPool.query(
      `INSERT INTO ingestion_configs (source_type, config) VALUES ('news_article', '{"keywords": ["excessive force"]}'::jsonb) RETURNING id`,
    );
    expect(inserted.rowCount).toBe(1);

    const updated = await internalPool.query(`UPDATE ingestion_configs SET last_run_at = now() WHERE id = $1`, [
      inserted.rows[0].id,
    ]);
    expect(updated.rowCount).toBe(1);

    const selected = await internalPool.query(`SELECT * FROM ingestion_configs WHERE id = $1`, [
      inserted.rows[0].id,
    ]);
    expect(selected.rowCount).toBe(1);
  });

  it("cop_public_api has no grant at all on ingestion_runs (no GRANT is a REVOKE by default)", async () => {
    await expect(
      internalPool.query(`SELECT 1`), // sanity: internal pool itself still works after the rejections below
    ).resolves.toBeDefined();

    await expect(publicPool.query(`SELECT * FROM ingestion_runs LIMIT 1`)).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    });
    await expect(
      publicPool.query(`INSERT INTO ingestion_runs (source_type, started_at) VALUES ('court_doc', now())`),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it("cop_public_api has no grant at all on ingestion_configs", async () => {
    await expect(publicPool.query(`SELECT * FROM ingestion_configs LIMIT 1`)).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    });
    await expect(
      publicPool.query(`INSERT INTO ingestion_configs (source_type, config) VALUES ('court_doc', '{}'::jsonb)`),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it("cop_internal_api cannot DELETE from either table (no DELETE grant at all, same convention as every other internal table)", async () => {
    await expect(
      internalPool.query(`DELETE FROM ingestion_runs WHERE id = $1`, ["00000000-0000-0000-0000-000000000000"]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    await expect(
      internalPool.query(`DELETE FROM ingestion_configs WHERE id = $1`, ["00000000-0000-0000-0000-000000000000"]),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });
});
