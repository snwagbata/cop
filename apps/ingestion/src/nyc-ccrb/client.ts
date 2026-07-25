/**
 * NYC CCRB (Civilian Complaint Review Board) Socrata Open Data client --
 * INGESTION_DESIGN.md §3.2's pilot, pivoted from a state decertification
 * registry to a city civilian-complaint-review source. See
 * docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md
 * for why, and for the full schema this file's types mirror.
 *
 * Two joined Socrata datasets on data.cityofnewyork.us. Every query
 * pattern below ($where date filter, $offset pagination, $where
 * tax_id in(...) batch join) was live-verified against the real API
 * during this pipeline's design -- unlike courtlistener/client.ts, this
 * file does not ship with an "unverified contract" warning.
 *   - 6xgr-kwjq: Allegations Against Police Officers (fetch target --
 *     one row per complaint+officer+allegation triple)
 *   - 2fir-qns4: Police Officers (joined by tax_id, for name/shield)
 */

const BASE_URL = "https://data.cityofnewyork.us/resource";
const ALLEGATIONS_DATASET = "6xgr-kwjq";
const OFFICERS_DATASET = "2fir-qns4";

const PAGE_SIZE = 1000;
/** Hard cap so a misbehaving/unexpectedly large window can't turn one run
 * into an unbounded fetch loop -- same defensive convention as
 * courtlistener/client.ts's MAX_PAGES, generous relative to this
 * pipeline's actual expected volume (a 30-day window of one department's
 * allegations). */
const MAX_PAGES = 50;
/** Socrata SoQL query-string length is comfortably fine at this batch
 * size for tax_id lookups. */
const OFFICER_BATCH_SIZE = 200;

/** Normalized shape this client produces -- the only thing run.ts depends
 * on. */
export interface NycCcrbAllegation {
  /** Together with allegationRecordIdentity, this pipeline's dedup key
   * (INGESTION_DESIGN.md §2's external_ref). A single complaint+officer
   * pair can have multiple distinct allegation rows (e.g. both "Force"
   * and "Abuse of Authority" against the same officer on the same
   * complaint) -- complaintOfficerNumber alone is NOT unique per
   * allegation, hence allegationRecordIdentity below. */
  complaintId: string;
  complaintOfficerNumber: string;
  /** Uniquely identifies one allegation row within a complaint+officer
   * pair (Socrata's `allegation_record_identity`). Required, not
   * optional -- see normalizeAllegation's guard. */
  allegationRecordIdentity: string;
  fadoType: string;
  allegation: string;
  ccrbDisposition: string | null;
  nypdDisposition: string | null;
  officerFirstName: string | null;
  officerLastName: string | null;
  shieldNo: string | null;
}

interface RawAllegationRow {
  complaint_id?: string;
  complaint_officer_number?: string;
  allegation_record_identity?: string;
  tax_id?: string;
  fado_type?: string;
  allegation?: string;
  ccrb_allegation_disposition?: string;
  nypd_allegation_disposition?: string;
}

interface RawOfficerRow {
  tax_id?: string;
  officer_first_name?: string;
  officer_last_name?: string;
  shield_no?: string;
}

function requestHeaders(appToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": "cop-ingestion-pipeline" };
  if (appToken) {
    headers["X-App-Token"] = appToken;
  }
  return headers;
}

async function fetchSocrataJson<T>(url: string, appToken?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: requestHeaders(appToken) });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`NYC CCRB request failed (network error) for ${url}: ${cause}`);
  }

  if (!response.ok) {
    throw new Error(`NYC CCRB request failed: ${response.status} ${response.statusText} (url=${url})`);
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`NYC CCRB response was not valid JSON (url=${url}): ${cause}`);
  }
}

/**
 * Fetches allegations with `as_of_date` within the trailing `sinceDays`
 * window (default 30 -- generous overlap; already-seen rows are filtered
 * by hasBeenQueued in run.ts before any DB write), paginated via
 * $limit/$offset until a page returns fewer than PAGE_SIZE rows, then
 * batch-joins officer name/shield by tax_id.
 */
export async function fetchNycCcrbAllegations(
  options: { sinceDays?: number; appToken?: string } = {},
): Promise<NycCcrbAllegation[]> {
  const sinceDays = options.sinceDays ?? 30;
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rawAllegations: RawAllegationRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    params.set("$where", `as_of_date >= '${sinceDate}'`);
    params.set("$limit", String(PAGE_SIZE));
    params.set("$offset", String(page * PAGE_SIZE));
    const url = `${BASE_URL}/${ALLEGATIONS_DATASET}.json?${params.toString()}`;

    const rows = await fetchSocrataJson<RawAllegationRow[]>(url, options.appToken);
    rawAllegations.push(...rows);
    if (rows.length < PAGE_SIZE) {
      break;
    }
  }

  const taxIds = [...new Set(rawAllegations.map((r) => r.tax_id).filter((id): id is string => Boolean(id)))];
  const officersByTaxId = await fetchOfficersByTaxId(taxIds, options.appToken);

  const results: NycCcrbAllegation[] = [];
  for (const raw of rawAllegations) {
    const normalized = normalizeAllegation(raw, officersByTaxId);
    if (normalized !== null) {
      results.push(normalized);
    }
  }
  return results;
}

async function fetchOfficersByTaxId(taxIds: string[], appToken?: string): Promise<Map<string, RawOfficerRow>> {
  const byTaxId = new Map<string, RawOfficerRow>();
  if (taxIds.length === 0) {
    return byTaxId;
  }

  for (let i = 0; i < taxIds.length; i += OFFICER_BATCH_SIZE) {
    const batch = taxIds.slice(i, i + OFFICER_BATCH_SIZE);
    const quoted = batch.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    const params = new URLSearchParams();
    params.set("$where", `tax_id in(${quoted})`);
    params.set("$limit", String(OFFICER_BATCH_SIZE));
    const url = `${BASE_URL}/${OFFICERS_DATASET}.json?${params.toString()}`;

    const rows = await fetchSocrataJson<RawOfficerRow[]>(url, appToken);
    for (const row of rows) {
      if (row.tax_id) {
        byTaxId.set(row.tax_id, row);
      }
    }
  }
  return byTaxId;
}

function normalizeAllegation(raw: RawAllegationRow, officersByTaxId: Map<string, RawOfficerRow>): NycCcrbAllegation | null {
  if (!raw.complaint_id || !raw.complaint_officer_number || !raw.allegation_record_identity) {
    // No stable composite id -- can't dedupe this row. Skip rather than
    // throw, same defensive-parsing convention as courtlistener/client.ts.
    return null;
  }

  const officer = raw.tax_id ? officersByTaxId.get(raw.tax_id) : undefined;

  return {
    complaintId: raw.complaint_id,
    complaintOfficerNumber: raw.complaint_officer_number,
    allegationRecordIdentity: raw.allegation_record_identity,
    fadoType: raw.fado_type ?? "Unknown",
    allegation: raw.allegation ?? "Unknown",
    ccrbDisposition: raw.ccrb_allegation_disposition ?? null,
    nypdDisposition: raw.nypd_allegation_disposition ?? null,
    officerFirstName: officer?.officer_first_name ?? null,
    officerLastName: officer?.officer_last_name ?? null,
    shieldNo: officer?.shield_no ?? null,
  };
}
