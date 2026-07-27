import type pg from "pg";
import { fetchNycCcrbAllegations } from "./client.js";
import { isNycCcrbConfig, type NycCcrbRunConfig } from "./run.js";

/**
 * One-time operational script (design doc §4): re-fetches NYC CCRB
 * allegations already queued from the first real production run (before
 * this feature existed, when every item landed with officerId: null) and
 * resolves each still-pending review_queue row's officer via
 * external_officer_ref -- expected to hit for nearly all of them once
 * backfillOfficers.ts's bulk import has populated the roster. Run this
 * AFTER that bulk import, not before (or every lookup here will miss).
 *
 * Only touches rows still in 'pending' status -- anything a reviewer
 * already approved or rejected by hand is left untouched.
 */

export interface NycCcrbReviewQueueBackfillResult {
  departmentName: string;
  allegationsChecked: number;
  reviewQueueRowsUpdated: number;
}

export async function runNycCcrbReviewQueueBackfill(
  pool: pg.Pool,
  env: { socrataAppToken?: string },
  deps: { fetchNycCcrbAllegations: typeof fetchNycCcrbAllegations } = { fetchNycCcrbAllegations },
): Promise<NycCcrbReviewQueueBackfillResult[]> {
  const configResult = await pool.query<{ id: string; config: unknown }>(
    `SELECT id, config FROM ingestion_configs WHERE source_type = 'nyc_ccrb' AND enabled = true`,
  );

  const results: NycCcrbReviewQueueBackfillResult[] = [];
  for (const row of configResult.rows) {
    if (!isNycCcrbConfig(row.config)) {
      console.error(`ingestion_configs row ${row.id} (source_type=nyc_ccrb): config does not match expected shape -- skipping.`);
      continue;
    }
    results.push(await backfillOneConfigRow(pool, env, deps, row.config));
  }
  return results;
}

async function backfillOneConfigRow(
  pool: pg.Pool,
  env: { socrataAppToken?: string },
  deps: { fetchNycCcrbAllegations: typeof fetchNycCcrbAllegations },
  config: NycCcrbRunConfig,
): Promise<NycCcrbReviewQueueBackfillResult> {
  const allegations = await deps.fetchNycCcrbAllegations({ appToken: env.socrataAppToken });
  let updated = 0;

  for (const allegation of allegations) {
    if (!allegation.taxId) {
      continue;
    }
    const officerResult = await pool.query<{ id: string }>(`SELECT id FROM officers WHERE external_officer_ref = $1`, [
      `nyc_ccrb:${allegation.taxId}`,
    ]);
    const officerId = officerResult.rows[0]?.id;
    if (!officerId) {
      continue; // not resolvable yet -- left exactly as-is, per design doc §4 step 4
    }

    const externalRef = `${allegation.complaintId}:${allegation.allegationRecordIdentity}`;
    const result = await pool.query(
      `UPDATE review_queue
          SET proposed_record = (proposed_record - 'officerName') || jsonb_build_object('officerId', $1::text),
              match_confidence = 'high'
        WHERE status = 'pending'
          AND source_id = (SELECT id FROM sources WHERE external_ref = $2)`,
      [officerId, externalRef],
    );
    updated += result.rowCount ?? 0;
  }

  return { departmentName: config.departmentName, allegationsChecked: allegations.length, reviewQueueRowsUpdated: updated };
}
