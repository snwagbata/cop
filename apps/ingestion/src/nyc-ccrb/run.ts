import type pg from "pg";
import { hasBeenQueued, matchOfficer, queueCandidate, startRun, finishRun } from "@cop/ingestion-lib";
import type { CandidateItem, MatchResult } from "@cop/ingestion-lib";
import { fetchNycCcrbAllegations, type NycCcrbAllegation } from "./client.js";
import { mapNypdDispositionToOutcomeType } from "./disposition.js";

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

export function isNycCcrbConfig(value: unknown): value is NycCcrbRunConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.departmentName === "string" && v.departmentName.trim().length > 0;
}

/**
 * Resolves an allegation's officer, in priority order:
 *  1. external_officer_ref exact hit (nyc_ccrb:<taxId>) -- authoritative,
 *     'high' confidence, no fuzzy matching needed. Expected to hit for
 *     ~100% of allegations once backfillOfficers.ts's bulk import has run
 *     for this department; only misses for an officer newly added to
 *     CCRB's dataset since the last bulk import.
 *  2. matchOfficer's existing name+department fuzzy match, unchanged --
 *     in case a reviewer already manually created a matching officer.
 *     Deliberately does NOT stamp external_officer_ref onto a match found
 *     this way (design doc §3): promoting an ambiguous fuzzy match into a
 *     permanent hard identity link would compound a wrong guess into every
 *     future run.
 *  3. Create a new officer from this allegation's own CCRB roster fields
 *     (rare -- only reached when both 1 and 2 miss), same field mapping
 *     backfillOfficers.ts uses for the bulk import.
 */
async function resolveOrCreateOfficer(
  pool: pg.Pool,
  allegation: NycCcrbAllegation,
  config: NycCcrbRunConfig,
  departmentId: string,
): Promise<MatchResult> {
  if (allegation.taxId) {
    const existing = await pool.query<{ id: string }>(`SELECT id FROM officers WHERE external_officer_ref = $1`, [
      `nyc_ccrb:${allegation.taxId}`,
    ]);
    if (existing.rows[0]) {
      return { officerId: existing.rows[0].id, confidence: "high" };
    }
  }

  const officerName =
    allegation.officerFirstName && allegation.officerLastName
      ? `${allegation.officerFirstName} ${allegation.officerLastName}`
      : undefined;

  const matched = await matchOfficer(pool, { name: officerName, departmentName: config.departmentName });
  if (matched.officerId) {
    return matched;
  }

  if (!allegation.taxId || !allegation.officerFirstName || !allegation.officerLastName) {
    // Nothing stable to create a new officer from -- leave unresolved.
    // run.ts's caller already surfaces a note for this case.
    return { officerId: null, confidence: "low" };
  }

  const employmentStatus = allegation.officerActive === true ? "active" : "inactive";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query<{ id: string }>(
      `INSERT INTO officers (first_name, last_name, department_id, badge_number, rank, employment_status, external_officer_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        allegation.officerFirstName,
        allegation.officerLastName,
        departmentId,
        allegation.shieldNo,
        allegation.officerRank,
        employmentStatus,
        `nyc_ccrb:${allegation.taxId}`,
      ],
    );
    const officerId = created.rows[0].id;

    await client.query(
      `INSERT INTO record_revisions (record_type, record_id, change_type, diff, changed_by)
       VALUES ('officer', $1, 'create', $2, NULL)`,
      [
        officerId,
        JSON.stringify({ source: "nyc_ccrb_pipeline_create_on_miss", externalOfficerRef: `nyc_ccrb:${allegation.taxId}` }),
      ],
    );

    await client.query("COMMIT");
    return { officerId, confidence: "high" };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
    const deptResult = await pool.query<{ id: string }>(`SELECT id FROM departments WHERE name = $1`, [
      config.departmentName,
    ]);
    if (!deptResult.rows[0]) {
      throw new Error(`No department found with name "${config.departmentName}" -- cannot resolve/create officers.`);
    }
    const departmentId = deptResult.rows[0].id;

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

      const matchResult = await resolveOrCreateOfficer(pool, allegation, config, departmentId);

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

      const mappedOutcomeType = mapNypdDispositionToOutcomeType(allegation.nypdDisposition);

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
        proposedOutcome: mappedOutcomeType
          ? {
              outcomeType: mappedOutcomeType,
              date: allegation.closeDate ?? undefined,
              // Preserves the exact raw source string even though it's
              // mapped to a coarser enum -- a reviewer (and the public
              // record, once approved) can see precisely what NYPD's own
              // disposition said, not just this schema's 3-way bucket.
              details: allegation.nypdDisposition ?? undefined,
            }
          : undefined,
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
