import type pg from "pg";
import { hasBeenQueued, matchOfficer, queueCandidate, startRun, finishRun } from "@cop/ingestion-lib";
import type { CandidateItem } from "@cop/ingestion-lib";
import { searchCourtListener } from "./client.js";
import { extractOfficerFromPartyText } from "./extract.js";

/**
 * Orchestration for INGESTION_DESIGN.md §3.1's federal CourtListener/RECAP
 * pipeline -- the common pipeline shape from §2, specialized to this
 * source: fetch -> normalize (client.ts already normalizes) -> dedupe ->
 * [LLM extraction] -> entity match -> queue -> log, once per enabled
 * `ingestion_configs` row with source_type = 'courtlistener'.
 *
 * `ingestion_configs.source_type` ('courtlistener', identifying which
 * *pipeline* a config row belongs to) is deliberately a different value
 * from the `sources.source_type` this pipeline writes for each candidate
 * ('court_doc', the shared_types SourceType category -- see queue.ts /
 * CandidateItem.sourceType below). The state-court Juriscraper pipeline
 * (INGESTION_DESIGN.md §3.1's other half, out of scope for this workspace)
 * would use a different ingestion_configs.source_type ('juriscraper') while
 * writing the *same* sources.source_type ('court_doc') -- two pipelines,
 * one output category.
 */

/** Shape of one `ingestion_configs.config` row for this pipeline, per this
 * task's brief: a watched department plus the search terms used to find
 * its dockets. */
export interface CourtListenerRunConfig {
  keyword: string;
  court?: string;
  departmentName: string;
}

export interface CourtListenerRunEnv {
  courtListenerApiKey: string;
  anthropicApiKey: string;
}

/** Injectable dependencies -- tests replace both with mocks/stubs so the
 * orchestration logic can be exercised against a real Postgres test
 * database without making a real CourtListener or Anthropic API call. */
export interface CourtListenerRunDeps {
  searchCourtListener: typeof searchCourtListener;
  extractOfficerFromPartyText: typeof extractOfficerFromPartyText;
}

const defaultDeps: CourtListenerRunDeps = { searchCourtListener, extractOfficerFromPartyText };

function isCourtListenerConfig(value: unknown): value is CourtListenerRunConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.keyword === "string" &&
    v.keyword.trim().length > 0 &&
    typeof v.departmentName === "string" &&
    v.departmentName.trim().length > 0 &&
    (v.court === undefined || typeof v.court === "string")
  );
}

/**
 * Runs the federal CourtListener/RECAP pipeline for every enabled
 * `ingestion_configs` row with source_type = 'courtlistener'. Each row gets
 * its own `ingestion_runs` row (via startRun/finishRun); a failure
 * processing one row (a CourtListener request failing, a malformed
 * response, a DB error mid-loop) is caught and recorded on *that* row's
 * ingestion_runs entry, then the loop continues with the next config row --
 * one department's pipeline breaking must never silence every other
 * department's ingestion.
 */
export async function runCourtListenerPipeline(
  pool: pg.Pool,
  env: CourtListenerRunEnv,
  deps: CourtListenerRunDeps = defaultDeps,
): Promise<void> {
  const configResult = await pool.query<{ id: string; config: unknown }>(
    `SELECT id, config FROM ingestion_configs WHERE source_type = 'courtlistener' AND enabled = true`,
  );

  for (const row of configResult.rows) {
    if (!isCourtListenerConfig(row.config)) {
      // A config row that doesn't match the expected shape at all can't
      // even start a meaningful run (no keyword to search with) -- log and
      // move on rather than starting/failing an ingestion_runs row for a
      // request we never had enough to make.
      console.error(
        `ingestion_configs row ${row.id} (source_type=courtlistener): config does not match ` +
          `{ keyword: string, court?: string, departmentName: string } -- skipping this row.`,
      );
      continue;
    }
    await runOneConfigRow(pool, env, deps, row.id, row.config);
  }
}

async function runOneConfigRow(
  pool: pg.Pool,
  env: CourtListenerRunEnv,
  deps: CourtListenerRunDeps,
  configId: string,
  config: CourtListenerRunConfig,
): Promise<void> {
  const runId = await startRun(pool, "courtlistener");
  let itemsFetched = 0;
  let itemsQueued = 0;
  let itemsDeduped = 0;

  try {
    const dockets = await deps.searchCourtListener(env.courtListenerApiKey, {
      keyword: config.keyword,
      court: config.court,
    });
    itemsFetched = dockets.length;

    for (const docket of dockets) {
      const alreadyQueued = await hasBeenQueued(pool, "court_doc", docket.docketId);
      if (alreadyQueued) {
        itemsDeduped++;
        continue;
      }

      const extraction = await deps.extractOfficerFromPartyText(env.anthropicApiKey, docket.partyText);
      if (extraction.confidence === "none") {
        // Per this task's brief (step 4): skip queuing entirely when
        // extraction can't identify an officer at all. Not counted as
        // fetched-but-deduped -- it simply never becomes a candidate.
        continue;
      }

      const matchResult = await matchOfficer(pool, {
        name: extraction.officerName ?? undefined,
        departmentName: config.departmentName,
      });

      const item: CandidateItem = {
        // shared_types SourceType category this candidate's `sources` row
        // gets -- see the file-level comment on why this differs from
        // ingestion_configs.source_type ('courtlistener').
        sourceType: "court_doc",
        externalUrl: docket.docketUrl || undefined,
        externalRef: docket.docketId,
        reliabilityTier: "tier1_primary_legal_doc",
        officerNameAsReported: extraction.officerName ?? undefined,
        departmentNameAsReported: config.departmentName,
        incidentType: "other",
        shortDescription: `Federal court docket${docket.court ? ` (${docket.court})` : ""}: ${docket.caseName}.`,
        dateAsReported: docket.dateFiled ?? undefined,
        note:
          extraction.confidence === "ambiguous"
            ? "Automated extraction of the officer's name from this docket's party text was ambiguous -- verify against the source document before approving."
            : undefined,
      };

      // queueCandidate needs a checked-out transactional client (it writes
      // sources + review_queue in one transaction) -- see queue.ts's
      // docstring. hasBeenQueued/matchOfficer above only read, so the pool
      // itself (which satisfies Queryable) is fine for those.
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
