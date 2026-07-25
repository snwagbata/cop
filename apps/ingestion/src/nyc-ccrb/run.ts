import type pg from "pg";
import { hasBeenQueued, matchOfficer, queueCandidate, startRun, finishRun } from "@cop/ingestion-lib";
import type { CandidateItem } from "@cop/ingestion-lib";
import { fetchNycCcrbAllegations } from "./client.js";

/**
 * Orchestration for INGESTION_DESIGN.md §3.2's NYC CCRB pilot -- the
 * common pipeline shape from §2, specialized to this source: fetch
 * (client.ts already normalizes and joins officer identity) -> dedupe ->
 * match -> queue -> log, once per enabled `ingestion_configs` row with
 * source_type = 'nyc_ccrb'. No extraction/LLM step -- unlike
 * courtlistener/run.ts, every field needed is already structured in the
 * source data.
 */

/** Shape of one `ingestion_configs.config` row for this pipeline. NYC
 * CCRB covers exactly one department (NYPD), so there's nothing else to
 * parameterize yet -- if a second city is added later, its own config
 * row is what varies, not this pipeline's code. */
export interface NycCcrbRunConfig {
  departmentName: string;
}

export interface NycCcrbRunEnv {
  /** Optional -- Socrata's unauthenticated rate limit is sufficient at
   * this pipeline's actual volume (weekly, one department); this is a
   * documented lever, not a requirement (INGESTION_DESIGN.md §1's "$0, no
   * required secrets" philosophy). */
  socrataAppToken?: string;
}

/** Injectable dependency -- tests replace this with a mock so the
 * orchestration logic can be exercised against a real Postgres test
 * database without making a real Socrata API call. */
export interface NycCcrbRunDeps {
  fetchNycCcrbAllegations: typeof fetchNycCcrbAllegations;
}

const defaultDeps: NycCcrbRunDeps = { fetchNycCcrbAllegations };

function isNycCcrbConfig(value: unknown): value is NycCcrbRunConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.departmentName === "string" && v.departmentName.trim().length > 0;
}

/**
 * Runs the NYC CCRB pipeline for every enabled `ingestion_configs` row
 * with source_type = 'nyc_ccrb'. Each row gets its own `ingestion_runs`
 * row; a failure processing one row is caught and recorded on that row's
 * entry, then the loop continues -- same isolation guarantee as
 * courtlistener/run.ts.
 */
export async function runNycCcrbPipeline(
  pool: pg.Pool,
  env: NycCcrbRunEnv,
  deps: NycCcrbRunDeps = defaultDeps,
): Promise<void> {
  const configResult = await pool.query<{ id: string; config: unknown }>(
    `SELECT id, config FROM ingestion_configs WHERE source_type = 'nyc_ccrb' AND enabled = true`,
  );

  for (const row of configResult.rows) {
    if (!isNycCcrbConfig(row.config)) {
      console.error(
        `ingestion_configs row ${row.id} (source_type=nyc_ccrb): config does not match ` +
          `{ departmentName: string } -- skipping this row.`,
      );
      continue;
    }
    await runOneConfigRow(pool, env, deps, row.id, row.config);
  }
}

async function runOneConfigRow(
  pool: pg.Pool,
  env: NycCcrbRunEnv,
  deps: NycCcrbRunDeps,
  configId: string,
  config: NycCcrbRunConfig,
): Promise<void> {
  const runId = await startRun(pool, "nyc_ccrb");
  let itemsFetched = 0;
  let itemsQueued = 0;
  let itemsDeduped = 0;

  try {
    const allegations = await deps.fetchNycCcrbAllegations({ appToken: env.socrataAppToken });
    itemsFetched = allegations.length;

    for (const allegation of allegations) {
      const externalRef = `${allegation.complaintId}:${allegation.allegationRecordIdentity}`;
      const alreadyQueued = await hasBeenQueued(pool, "official_dataset", externalRef);
      if (alreadyQueued) {
        itemsDeduped++;
        continue;
      }

      const officerName =
        allegation.officerFirstName && allegation.officerLastName
          ? `${allegation.officerFirstName} ${allegation.officerLastName}`
          : undefined;

      const matchResult = await matchOfficer(pool, {
        name: officerName,
        departmentName: config.departmentName,
      });

      const noteParts: string[] = [];
      if (!officerName) {
        noteParts.push(
          "NYPD's CCRB roster did not return an officer name for this allegation's tax_id -- verify identity before approving.",
        );
      } else if (!allegation.shieldNo) {
        noteParts.push(
          "No shield number on file for this officer in NYPD's CCRB roster -- verify identity before approving.",
        );
      }
      if (!allegation.incidentDate) {
        noteParts.push(
          "No incident date returned by NYC's Complaints dataset for this allegation's complaint_id -- a date is required before this candidate can be approved.",
        );
      }

      const item: CandidateItem = {
        sourceType: "official_dataset",
        externalRef,
        reliabilityTier: "tier2_official_dataset",
        officerNameAsReported: officerName,
        departmentNameAsReported: config.departmentName,
        incidentType: allegation.fadoType === "Force" ? "use_of_force" : "other",
        shortDescription:
          `CCRB complaint: ${allegation.fadoType} - ${allegation.allegation}` +
          (allegation.ccrbDisposition ? ` (${allegation.ccrbDisposition}).` : "."),
        dateAsReported: allegation.incidentDate ?? undefined,
        note: noteParts.length > 0 ? noteParts.join(" ") : undefined,
      };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await queueCandidate(client, item, matchResult);
        await client.query("COMMIT");
        itemsQueued++;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    await finishRun(pool, runId, { itemsFetched, itemsQueued, itemsDeduped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(pool, runId, { itemsFetched, itemsQueued, itemsDeduped, error: message });
  }

  await pool.query(`UPDATE ingestion_configs SET last_run_at = now() WHERE id = $1`, [configId]);
}
