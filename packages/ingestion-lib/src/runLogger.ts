import type { Queryable } from "./types.js";

/** Starts an ingestion_runs row for a poll-based pipeline's run and returns
 * its id. Call once at the start of a run, before fetch/normalize/dedupe/
 * match/queue begins, so a crash partway through still leaves a row with a
 * NULL finished_at -- itself the signal something went wrong (§5). */
export async function startRun(client: Queryable, sourceType: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO ingestion_runs (source_type, started_at) VALUES ($1, now()) RETURNING id`,
    [sourceType],
  );
  return result.rows[0].id;
}

/** Finalizes an ingestion_runs row with the run's counts (and an error
 * message, if the run failed partway through but is still able to record
 * why). Call once at the end of a run, in a finally-block so it still runs
 * on the error path. */
export async function finishRun(
  client: Queryable,
  runId: string,
  result: { itemsFetched: number; itemsQueued: number; itemsDeduped: number; error?: string },
): Promise<void> {
  await client.query(
    `UPDATE ingestion_runs
        SET finished_at = now(),
            items_fetched = $2,
            items_queued = $3,
            items_deduped = $4,
            error = $5
      WHERE id = $1`,
    [runId, result.itemsFetched, result.itemsQueued, result.itemsDeduped, result.error ?? null],
  );
}
