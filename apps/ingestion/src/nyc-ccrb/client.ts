/**
 * NYC CCRB (Civilian Complaint Review Board) Socrata Open Data client --
 * INGESTION_DESIGN.md §3.2's pilot. See
 * docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md
 * §8 for why this fetch is Complaints-first: the original Allegations-first
 * design filtered on as_of_date, which turned out to be a single
 * whole-table snapshot timestamp shared by all 430,011 rows, not a
 * per-row date -- live-verified to not window anything at all. The
 * Complaints dataset (2mby-ccnw) has a genuine per-row close_date
 * (live-verified range: 2000-2026), and only 549 complaints closed in a
 * live-checked trailing 30-day window, vs. 430,011 total Allegations rows
 * -- a properly bounded fetch.
 *
 * Three joined Socrata datasets on data.cityofnewyork.us:
 *   - 2mby-ccnw: Complaints Against Police Officers (windowing source --
 *     fetched first, filtered by close_date, for complaint_id + incident_date)
 *   - 6xgr-kwjq: Allegations Against Police Officers (fetch target --
 *     one row per complaint+officer+allegation triple, batch-fetched by
 *     the complaint_ids found above)
 *   - 2fir-qns4: Police Officers (joined by tax_id, for name/shield)
 */

const BASE_URL = "https://data.cityofnewyork.us/resource";
const COMPLAINTS_DATASET = "2mby-ccnw";
const ALLEGATIONS_DATASET = "6xgr-kwjq";
const OFFICERS_DATASET = "2fir-qns4";

const PAGE_SIZE = 1000;
/** Hard cap on Complaints pagination so a misbehaving/unexpectedly large
 * window can't turn one run into an unbounded fetch loop. Generous
 * relative to this pipeline's live-verified actual volume (549
 * complaints/30-day window) -- 10 pages would mean 10,000 complaints
 * closed in that window, ~18x the observed rate. */
const MAX_PAGES = 10;
/** Shared by both batched $where <field> in(...) queries below (complaint_id
 * against Allegations, tax_id against Officers) -- Socrata SoQL
 * query-string length is comfortably fine at this batch size for either. */
const BATCH_SIZE = 200;

/** Hard cap on pagination for fetchAllNycCcrbOfficers's full-dataset fetch
 * (unlike the tax_id-scoped join above, this fetches every row in
 * 2fir-qns4, not just ones referenced by recently-fetched allegations).
 * Live-verified total row count: 97,551 (2026-07-27, `$select=count(tax_id)`)
 * -- 150 pages * 1,000 = 150,000 gives comfortable headroom for roster
 * growth before this cap could ever bind. */
const OFFICERS_FULL_FETCH_MAX_PAGES = 150;

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
  /** CCRB's own stable per-officer id, straight through from the
   * Allegations row's tax_id (not looked up via the Officers join --
   * available even when the Officers-dataset join below found nothing).
   * The weekly pipeline's officer-resolution key (run.ts) and the bulk
   * importer's dedup key (backfillOfficers.ts) both key on this,
   * namespaced as "nyc_ccrb:<taxId>". Null only when the Allegations row
   * itself had no tax_id on file. */
  taxId: string | null;
  /** From the Officers-dataset join's current_rank field (e.g.
   * "Sergeant") -- null if the join found nothing or the field was
   * absent. */
  officerRank: string | null;
  /** From the Officers-dataset join's active_per_last_reported_status
   * field: true for "Yes", false for anything else present, null if the
   * join found nothing or the field itself was absent (distinct from
   * false -- "known inactive" vs "unknown"). */
  officerActive: boolean | null;
  /** From the Complaints join -- null if that complaint had no
   * incident_date on file (rare; run.ts surfaces a note when this
   * happens, since a date is required for review-queue approval). */
  incidentDate: string | null;
  /** CCRB's own close_date for the complaint this allegation belongs to
   * (when the case was closed, not when the alleged incident occurred) --
   * truncated to YYYY-MM-DD. Every complaint this pipeline ever fetches is
   * already filtered to be closed (fetchClosedComplaints's whole purpose),
   * so this is expected to be present in practice; null only if the raw
   * field was genuinely absent. Used as the outcome's date (never
   * incidentDate -- that would conflate two different dates). */
  closeDate: string | null;
}

interface RawComplaintRow {
  complaint_id?: string;
  incident_date?: string;
  close_date?: string;
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
  current_rank?: string;
  active_per_last_reported_status?: string;
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
 * Batched `$where <field> in(...)` fetch against any of this client's
 * three datasets -- shared by the complaint_id (Allegations) and tax_id
 * (Officers) joins below rather than duplicating the batching/escaping
 * logic twice.
 */
async function fetchBatchedIn<T>(dataset: string, field: string, values: string[], appToken?: string): Promise<T[]> {
  const results: T[] = [];
  if (values.length === 0) {
    return results;
  }

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    const quoted = batch.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
    const whereClause = `${field} in(${quoted})`;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams();
      params.set("$where", whereClause);
      params.set("$limit", String(PAGE_SIZE));
      params.set("$offset", String(page * PAGE_SIZE));
      const url = `${BASE_URL}/${dataset}.json?${params.toString()}`;

      const rows = await fetchSocrataJson<T[]>(url, appToken);
      results.push(...rows);
      if (rows.length < PAGE_SIZE) {
        break;
      }
    }
  }
  return results;
}

interface ComplaintDates {
  incidentDate: string | null;
  closeDate: string | null;
}

/**
 * Fetches complaints closed within the trailing `sinceDays` window
 * (default 30), paginated via $limit/$offset until a page returns fewer
 * than PAGE_SIZE rows. This is the pipeline's actual incremental-window
 * source (see file-level comment) -- already-seen complaints are filtered
 * by hasBeenQueued in run.ts before any DB write, same as before.
 */
async function fetchClosedComplaints(sinceDays: number, appToken?: string): Promise<Map<string, ComplaintDates>> {
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const datesByComplaintId = new Map<string, ComplaintDates>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    params.set("$where", `close_date >= '${sinceDate}'`);
    params.set("$select", "complaint_id,incident_date,close_date");
    params.set("$limit", String(PAGE_SIZE));
    params.set("$offset", String(page * PAGE_SIZE));
    const url = `${BASE_URL}/${COMPLAINTS_DATASET}.json?${params.toString()}`;

    const rows = await fetchSocrataJson<RawComplaintRow[]>(url, appToken);
    for (const row of rows) {
      if (row.complaint_id) {
        datesByComplaintId.set(row.complaint_id, {
          incidentDate: row.incident_date ?? null,
          // Truncated to YYYY-MM-DD (raw field includes a time component,
          // e.g. "2011-06-01T18:11:15.000") -- matches how sinceDate itself
          // is computed above, and matches outcomes.date's plain `date`
          // column type.
          closeDate: row.close_date ? row.close_date.slice(0, 10) : null,
        });
      }
    }
    if (rows.length < PAGE_SIZE) {
      break;
    }
  }
  return datesByComplaintId;
}

/**
 * Fetches allegations, complaints-first: queries Complaints for the
 * trailing `sinceDays` window, batch-fetches matching Allegations by
 * complaint_id, then batch-joins officer name/shield by tax_id.
 */
export async function fetchNycCcrbAllegations(
  options: { sinceDays?: number; appToken?: string } = {},
): Promise<NycCcrbAllegation[]> {
  const sinceDays = options.sinceDays ?? 30;

  const datesByComplaintId = await fetchClosedComplaints(sinceDays, options.appToken);
  const complaintIds = [...datesByComplaintId.keys()];

  const rawAllegations = await fetchBatchedIn<RawAllegationRow>(
    ALLEGATIONS_DATASET,
    "complaint_id",
    complaintIds,
    options.appToken,
  );

  const taxIds = [...new Set(rawAllegations.map((r) => r.tax_id).filter((id): id is string => Boolean(id)))];
  const officerRows = await fetchBatchedIn<RawOfficerRow>(OFFICERS_DATASET, "tax_id", taxIds, options.appToken);
  const officersByTaxId = new Map<string, RawOfficerRow>();
  for (const row of officerRows) {
    if (row.tax_id) {
      officersByTaxId.set(row.tax_id, row);
    }
  }

  const results: NycCcrbAllegation[] = [];
  for (const raw of rawAllegations) {
    const normalized = normalizeAllegation(raw, officersByTaxId, datesByComplaintId);
    if (normalized !== null) {
      results.push(normalized);
    }
  }
  return results;
}

function normalizeAllegation(
  raw: RawAllegationRow,
  officersByTaxId: Map<string, RawOfficerRow>,
  datesByComplaintId: Map<string, ComplaintDates>,
): NycCcrbAllegation | null {
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
    taxId: raw.tax_id ?? null,
    officerRank: officer?.current_rank ?? null,
    officerActive: officer?.active_per_last_reported_status === undefined
      ? null
      : officer.active_per_last_reported_status === "Yes",
    incidentDate: datesByComplaintId.get(raw.complaint_id)?.incidentDate ?? null,
    closeDate: datesByComplaintId.get(raw.complaint_id)?.closeDate ?? null,
  };
}

/** One row of NYC CCRB's full Officers reference dataset (2fir-qns4) --
 * the shape apps/ingestion/src/nyc-ccrb/backfillOfficers.ts bulk-imports
 * from, and the same shape run.ts's rare create-on-miss path derives from
 * a single allegation's join fields. */
export interface NycCcrbOfficerRosterEntry {
  taxId: string;
  firstName: string;
  lastName: string;
  badgeNumber: string | null;
  rank: string | null;
  /** true for "Yes", false for anything else present or absent -- unlike
   * NycCcrbAllegation.officerActive, this is never null: every row in the
   * full Officers dataset either has this field or doesn't, and "unknown"
   * isn't a useful distinction for a bulk-import default (design doc §2:
   * "'No'/missing -> 'inactive'"). */
  active: boolean;
}

function normalizeOfficerRosterEntry(raw: RawOfficerRow): NycCcrbOfficerRosterEntry | null {
  if (!raw.tax_id || !raw.officer_first_name || !raw.officer_last_name) {
    // No stable id or no name -- nothing usable to create an officer from.
    // Skip rather than throw, same defensive-parsing convention as
    // normalizeAllegation above.
    return null;
  }
  return {
    taxId: raw.tax_id,
    firstName: raw.officer_first_name,
    lastName: raw.officer_last_name,
    badgeNumber: raw.shield_no ?? null,
    rank: raw.current_rank ?? null,
    active: raw.active_per_last_reported_status === "Yes",
  };
}

/**
 * Fetches NYC CCRB's *entire* Officers reference dataset (2fir-qns4) --
 * every officer CCRB has ever tracked, not scoped to any recent window or
 * tax_id list (unlike fetchNycCcrbAllegations's join, which only looks up
 * tax_ids referenced by recently-fetched allegations). Backs the one-time
 * bulk-import script (backfillOfficers.ts) that seeds a department's
 * initial officer roster. Paginates until a short page or
 * OFFICERS_FULL_FETCH_MAX_PAGES, same shape as fetchClosedComplaints's own
 * pagination loop.
 */
export async function fetchAllNycCcrbOfficers(
  options: { appToken?: string } = {},
): Promise<NycCcrbOfficerRosterEntry[]> {
  const results: NycCcrbOfficerRosterEntry[] = [];

  for (let page = 0; page < OFFICERS_FULL_FETCH_MAX_PAGES; page++) {
    const params = new URLSearchParams();
    params.set("$limit", String(PAGE_SIZE));
    params.set("$offset", String(page * PAGE_SIZE));
    const url = `${BASE_URL}/${OFFICERS_DATASET}.json?${params.toString()}`;

    const rows = await fetchSocrataJson<RawOfficerRow[]>(url, options.appToken);
    for (const raw of rows) {
      const normalized = normalizeOfficerRosterEntry(raw);
      if (normalized !== null) {
        results.push(normalized);
      }
    }

    if (rows.length < PAGE_SIZE) {
      break;
    }
  }

  return results;
}
