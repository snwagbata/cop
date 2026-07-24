import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, closeAllPools, authHeader, loginAsAdmin, loginAsReviewer } from "./helpers.js";
import { resetDb, superPool } from "./db.js";

describe("GET /api/internal/ingestion-runs", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    token = await loginAsAdmin();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it("returns an empty list when no pipeline has ever run (expected pre-pipeline state)", async () => {
    const res = await request(app).get("/api/internal/ingestion-runs").set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([]);
  });

  it("lists runs newest-first, mapping every column to the IngestionRun shape", async () => {
    const older = await superPool.query(
      `INSERT INTO ingestion_runs (source_type, started_at, finished_at, items_fetched, items_queued, items_deduped)
       VALUES ('decertification_registry', now() - interval '2 days', now() - interval '2 days' + interval '5 minutes', 10, 3, 7)
       RETURNING id`,
    );
    const newer = await superPool.query(
      `INSERT INTO ingestion_runs (source_type, started_at, finished_at, items_fetched, items_queued, items_deduped, error)
       VALUES ('court_doc', now() - interval '1 hour', now() - interval '55 minutes', 4, 4, 0, NULL)
       RETURNING id`,
    );

    const res = await request(app).get("/api/internal/ingestion-runs").set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2);

    // Newest-first ordering.
    expect(res.body.runs[0].id).toBe(newer.rows[0].id);
    expect(res.body.runs[1].id).toBe(older.rows[0].id);

    expect(res.body.runs[0]).toMatchObject({
      sourceType: "court_doc",
      itemsFetched: 4,
      itemsQueued: 4,
      itemsDeduped: 0,
      error: null,
    });
    expect(res.body.runs[0].startedAt).toBeDefined();
    expect(res.body.runs[0].finishedAt).toBeDefined();
  });

  it("surfaces a still-running (finishedAt null) run as-is, without hiding or erroring on it", async () => {
    const stuck = await superPool.query(
      `INSERT INTO ingestion_runs (source_type, started_at) VALUES ('news_article', now() - interval '3 hours') RETURNING id`,
    );

    const res = await request(app).get("/api/internal/ingestion-runs").set(...authHeader(token));
    expect(res.status).toBe(200);
    const run = res.body.runs.find((r: { id: string }) => r.id === stuck.rows[0].id);
    expect(run).toBeDefined();
    expect(run.finishedAt).toBeNull();
  });

  it("surfaces a run's error message when one is recorded", async () => {
    await superPool.query(
      `INSERT INTO ingestion_runs (source_type, started_at, finished_at, error)
       VALUES ('public_records_response', now() - interval '1 day', now() - interval '1 day', 'Upstream API returned 403.')`,
    );

    const res = await request(app).get("/api/internal/ingestion-runs").set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.runs[0].error).toBe("Upstream API returned 403.");
  });

  it("caps results at the most recent 50 runs", async () => {
    for (let i = 0; i < 55; i++) {
      await superPool.query(
        `INSERT INTO ingestion_runs (source_type, started_at) VALUES ('court_doc', now() - ($1 || ' minutes')::interval)`,
        [i],
      );
    }

    const res = await request(app).get("/api/internal/ingestion-runs").set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(50);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/internal/ingestion-runs");
    expect(res.status).toBe(401);
  });

  it("does not require admin role -- any authenticated reviewer can view it", async () => {
    const reviewerToken = await loginAsReviewer();
    const res = await request(app).get("/api/internal/ingestion-runs").set(...authHeader(reviewerToken));
    expect(res.status).toBe(200);
  });
});
