import type pg from "pg";
import { fetchAllNycCcrbOfficers, type NycCcrbOfficerRosterEntry } from "./client.js";
import { isNycCcrbConfig, type NycCcrbRunConfig } from "./run.js";

/**
 * One-time operational script (design doc §2): bulk-imports NYC CCRB's
 * entire Officers reference dataset (97,551 rows, live-verified count) as
 * a department's initial officer roster, so the weekly pipeline
 * (run.ts) has real officers to resolve against instead of always
 * creating one-off officer rows during the regular ingestion run. Not
 * part of the weekly schedule -- run manually, once, before (or instead
 * of) letting the weekly pipeline's own create-on-miss fallback populate
 * officers row by row.
 *
 * Batches inserts via unnest() rather than the one-row-per-transaction
 * pattern run.ts's main loop uses -- that pattern is correct for run.ts's
 * own reasons (see run.ts's docs) but does not scale to 97,551 rows (see
 * design doc §2's throughput math). Idempotent: re-running this script
 * only inserts officers not already present (ON CONFLICT ... DO NOTHING
 * on external_officer_ref), so it's safe to re-run after CCRB adds new
 * officers to their dataset.
 */

const CHUNK_SIZE = 2000;

export interface NycCcrbOfficerBulkImportDeps {
  fetchAllNycCcrbOfficers: typeof fetchAllNycCcrbOfficers;
}

const defaultDeps: NycCcrbOfficerBulkImportDeps = { fetchAllNycCcrbOfficers };

export interface NycCcrbOfficerBulkImportResult {
  configId: string;
  departmentName: string;
  totalFetched: number;
  totalImported: number;
}

export async function runNycCcrbOfficerBulkImport(
  pool: pg.Pool,
  env: { socrataAppToken?: string },
  deps: NycCcrbOfficerBulkImportDeps = defaultDeps,
  chunkSize: number = CHUNK_SIZE,
): Promise<NycCcrbOfficerBulkImportResult[]> {
  const configResult = await pool.query<{ id: string; config: unknown }>(
    `SELECT id, config FROM ingestion_configs WHERE source_type = 'nyc_ccrb' AND enabled = true`,
  );

  const results: NycCcrbOfficerBulkImportResult[] = [];

  for (const row of configResult.rows) {
    if (!isNycCcrbConfig(row.config)) {
      console.error(`ingestion_configs row ${row.id} (source_type=nyc_ccrb): config does not match expected shape -- skipping.`);
      continue;
    }
    results.push(await importOneConfigRow(pool, env, deps, row.config, chunkSize));
  }

  return results;
}

async function importOneConfigRow(
  pool: pg.Pool,
  env: { socrataAppToken?: string },
  deps: NycCcrbOfficerBulkImportDeps,
  config: NycCcrbRunConfig,
  chunkSize: number,
): Promise<NycCcrbOfficerBulkImportResult> {
  const deptResult = await pool.query<{ id: string }>(`SELECT id FROM departments WHERE name = $1`, [
    config.departmentName,
  ]);
  if (!deptResult.rows[0]) {
    throw new Error(`No department found with name "${config.departmentName}" -- cannot bulk-import officers.`);
  }
  const departmentId = deptResult.rows[0].id;

  const officers = await deps.fetchAllNycCcrbOfficers({ appToken: env.socrataAppToken });
  console.log(`Fetched ${officers.length} officer roster rows for "${config.departmentName}".`);

  let totalImported = 0;
  for (let i = 0; i < officers.length; i += chunkSize) {
    const chunk = officers.slice(i, i + chunkSize);
    const imported = await importChunk(pool, departmentId, chunk);
    totalImported += imported;
    console.log(`Imported ${totalImported}/${officers.length} so far (this chunk: ${imported} new, ${chunk.length - imported} already present).`);
  }

  return {
    configId: config.departmentName,
    departmentName: config.departmentName,
    totalFetched: officers.length,
    totalImported,
  };
}

async function importChunk(pool: pg.Pool, departmentId: string, chunk: NycCcrbOfficerRosterEntry[]): Promise<number> {
  const firstNames = chunk.map((o) => o.firstName);
  const lastNames = chunk.map((o) => o.lastName);
  const departmentIds = chunk.map(() => departmentId);
  const badgeNumbers = chunk.map((o) => o.badgeNumber);
  const ranks = chunk.map((o) => o.rank);
  const employmentStatuses = chunk.map((o) => (o.active ? "active" : "inactive"));
  const externalRefs = chunk.map((o) => `nyc_ccrb:${o.taxId}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query<{ id: string; external_officer_ref: string }>(
      `INSERT INTO officers
           (first_name, last_name, department_id, badge_number, rank, employment_status, external_officer_ref)
       SELECT * FROM unnest(
           $1::text[], $2::text[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[]
       )
       ON CONFLICT (external_officer_ref) WHERE external_officer_ref IS NOT NULL DO NOTHING
       RETURNING id, external_officer_ref`,
      [firstNames, lastNames, departmentIds, badgeNumbers, ranks, employmentStatuses, externalRefs],
    );

    if (inserted.rows.length > 0) {
      const ids = inserted.rows.map((r) => r.id);
      const refs = inserted.rows.map((r) => r.external_officer_ref);
      await client.query(
        `INSERT INTO record_revisions (record_type, record_id, change_type, diff, changed_by)
         SELECT 'officer', id, 'create', jsonb_build_object('source', 'nyc_ccrb_officer_bulk_import', 'externalOfficerRef', ref), NULL
         FROM unnest($1::uuid[], $2::text[]) AS t(id, ref)`,
        [ids, refs],
      );
    }

    await client.query("COMMIT");
    return inserted.rows.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
