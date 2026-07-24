import type { Queryable } from "./types.js";

/**
 * INGESTION_DESIGN.md §2's dedupe step: has this exact (source_type,
 * external_ref) pair already been queued by a prior run? Backed by
 * migration 0019's partial unique index -- this function is a plain read
 * check a pipeline calls *before* attempting to queue (queueCandidate
 * itself doesn't dedupe; the unique index is the last-resort DB-level
 * guarantee, this is the cheap first check that lets a pipeline skip
 * re-fetching/re-processing an already-seen item entirely).
 */
export async function hasBeenQueued(
  client: Queryable,
  sourceType: string,
  externalRef: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM sources WHERE source_type = $1 AND external_ref = $2)`,
    [sourceType, externalRef],
  );
  return result.rows[0].exists;
}
