import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { startRun, finishRun } from "../runLogger.js";

describe("startRun / finishRun", () => {
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

  it("starts a run with started_at set and finished_at null", async () => {
    const runId = await startRun(pool, "court_doc");

    const row = await pool.query(`SELECT source_type, started_at, finished_at FROM ingestion_runs WHERE id = $1`, [
      runId,
    ]);
    expect(row.rows[0].source_type).toBe("court_doc");
    expect(row.rows[0].started_at).not.toBeNull();
    expect(row.rows[0].finished_at).toBeNull();
  });

  it("finishes a run with counts and no error", async () => {
    const runId = await startRun(pool, "decertification_registry");

    await finishRun(pool, runId, { itemsFetched: 12, itemsQueued: 4, itemsDeduped: 8 });

    const row = await pool.query(
      `SELECT finished_at, items_fetched, items_queued, items_deduped, error FROM ingestion_runs WHERE id = $1`,
      [runId],
    );
    expect(row.rows[0].finished_at).not.toBeNull();
    expect(row.rows[0]).toMatchObject({ items_fetched: 12, items_queued: 4, items_deduped: 8, error: null });
  });

  it("records an error message when a run fails partway through", async () => {
    const runId = await startRun(pool, "news_article");

    await finishRun(pool, runId, {
      itemsFetched: 3,
      itemsQueued: 0,
      itemsDeduped: 0,
      error: "Upstream API returned 403 partway through the run.",
    });

    const row = await pool.query(`SELECT error, finished_at FROM ingestion_runs WHERE id = $1`, [runId]);
    expect(row.rows[0].error).toBe("Upstream API returned 403 partway through the run.");
    expect(row.rows[0].finished_at).not.toBeNull();
  });

  it("a run left with finished_at NULL is itself the 'something's wrong' signal (no auto-timeout)", async () => {
    await startRun(pool, "public_records_response");

    const stuck = await pool.query(`SELECT id FROM ingestion_runs WHERE finished_at IS NULL`);
    expect(stuck.rows.length).toBeGreaterThanOrEqual(1);
  });
});
