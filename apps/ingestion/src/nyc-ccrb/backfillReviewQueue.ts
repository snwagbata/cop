import type pg from "pg";
import { fetchNycCcrbAllegations } from "./client.js";
import { mapNypdDispositionToOutcomeType } from "./disposition.js";
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
 * Officer identity and structured outcome are resolved independently of
 * each other -- a row can gain a proposedOutcome even when its officer
 * still doesn't resolve, and vice versa, so this is also safe to re-run
 * against rows an earlier run already officer-resolved: it will add
 * proposedOutcome to them without disturbing their existing officerId.
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
  // sinceDays: 120, not the client's default 30 -- this script runs some
  // unknown number of days after the PR that ships it merges/deploys (see
  // design doc §4's "Post-implementation" operational step), so it must
  // still cover the original run's window even after a realistic
  // merge-to-run delay, or complaints from the oldest part of that window
  // silently age out of the re-fetch with no error and no signal.
  const allegations = await deps.fetchNycCcrbAllegations({ appToken: env.socrataAppToken, sinceDays: 120 });
  let updated = 0;

  for (const allegation of allegations) {
    const externalRef = `${allegation.complaintId}:${allegation.allegationRecordIdentity}`;

    let officerId: string | undefined;
    if (allegation.taxId) {
      const officerResult = await pool.query<{ id: string }>(
        `SELECT id FROM officers WHERE external_officer_ref = $1`,
        [`nyc_ccrb:${allegation.taxId}`],
      );
      officerId = officerResult.rows[0]?.id;
    }

    const outcomeType = mapNypdDispositionToOutcomeType(allegation.nypdDisposition);
    const proposedOutcome = outcomeType
      ? { outcomeType, date: allegation.closeDate ?? undefined, details: allegation.nypdDisposition ?? undefined }
      : undefined;

    if (!officerId && !proposedOutcome) {
      continue; // nothing new resolves for this allegation
    }

    let patch = "proposed_record";
    const params: unknown[] = [];
    if (officerId) {
      params.push(officerId);
      patch = `(${patch} - 'officerName') || jsonb_build_object('officerId', $${params.length}::text)`;
    }
    if (proposedOutcome) {
      params.push(JSON.stringify(proposedOutcome));
      patch = `${patch} || jsonb_build_object('proposedOutcome', $${params.length}::jsonb)`;
    }
    const confidenceClause = officerId ? `, match_confidence = 'high'` : "";
    params.push(externalRef);

    const result = await pool.query(
      `UPDATE review_queue
          SET proposed_record = ${patch}${confidenceClause}
        WHERE status = 'pending'
          AND source_id = (SELECT id FROM sources WHERE external_ref = $${params.length} AND source_type = 'official_dataset')`,
      params,
    );
    updated += result.rowCount ?? 0;
  }

  return { departmentName: config.departmentName, allegationsChecked: allegations.length, reviewQueueRowsUpdated: updated };
}
