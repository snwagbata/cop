# NYC CCRB Complaints-Join Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two real defects found by actually running the NYC CCRB pipeline against the live API and local Postgres (not just curling the API by hand): the `as_of_date` windowing filter doesn't window anything (every row in the 430k-row Allegations table shares one value), and every candidate queues with no incident date, which makes it permanently unapprovable through the normal admin UI (the approve endpoint 400s without one).

**Architecture:** Reorder the fetch flow to be Complaints-first: query the Complaints dataset (`2mby-ccnw`) by its real per-row `close_date` for the trailing window (live-verified: 549 complaints/30-day window, vs. 430,011 total rows in Allegations — a genuinely bounded fetch), batch-fetch matching Allegations by `complaint_id in (...)`, then batch-fetch Officers by `tax_id in (...)` as before. The two batched `in(...)` queries (complaint_id, tax_id) share one generic helper instead of duplicating the batching logic. `run.ts` gains `dateAsReported` from the new Complaints join and a note when a date is genuinely missing.

**Tech Stack:** Same as the original pipeline — TypeScript, native `fetch`, Vitest, no new dependencies.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md`, §8 (the correction section) — read for full context on why this fix is needed; this plan implements §8 exactly.
- `close_date` (not `ccrb_received_date`) drives the window — the Complaints/Allegations datasets only cover closed complaints, so there's nothing to gain from also filtering on received date.
- The dedup key (`external_ref` = `${complaintId}:${allegationRecordIdentity}`) is already correct from a prior fix wave — do not change it, only add the new Complaints join alongside it.
- No new npm dependencies.
- Every query pattern this plan uses (`$where close_date >=`, `$select`, `$where complaint_id in(...)`) must be live-verified against the real API before being treated as correct, matching this pipeline's existing standard — verification commands are given per step below, not left as an assumption.

---

### Task 1: Rework `client.ts` to a Complaints-first fetch

**Files:**
- Modify: `apps/ingestion/src/nyc-ccrb/client.ts`
- Modify: `apps/ingestion/test/nyc-ccrb/client.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NycCcrbAllegation` gains a new field, `incidentDate: string | null`. `fetchNycCcrbAllegations`'s exported signature (`(options?: { sinceDays?: number; appToken?: string }) => Promise<NycCcrbAllegation[]>`) is unchanged — Task 2's `run.ts` only needs to read the new field, not change how it calls this function.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/ingestion/test/nyc-ccrb/client.test.ts` with:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNycCcrbAllegations } from "../../src/nyc-ccrb/client.js";

/**
 * Mocked-HTTP tests for the NYC CCRB Socrata client. Every query pattern
 * asserted here ($where close_date filter on Complaints, $where
 * complaint_id in(...) batch fetch of Allegations, $where tax_id in(...)
 * batch join of Officers) was live-verified against the real
 * data.cityofnewyork.us API -- see
 * docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md
 * §8 for why this Complaints-first flow replaced the original
 * Allegations-first design (the original's as_of_date filter turned out
 * to not filter by date at all).
 */

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });
}

function urlFor(mock: ReturnType<typeof vi.fn>, datasetId: string, callIndex = 0): URL {
  const calls = mock.mock.calls.filter(([url]: [string]) => url.includes(datasetId));
  return new URL(calls[callIndex][0]);
}

describe("fetchNycCcrbAllegations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches closed complaints, joins matching allegations by complaint_id, and joins officer identity by tax_id", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "201806447", incident_date: "2018-01-05" }]);
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          {
            complaint_id: "201806447",
            complaint_officer_number: "1",
            allegation_record_identity: "240280",
            tax_id: "942643",
            fado_type: "Force",
            allegation: "Physical force",
            ccrb_allegation_disposition: "Substantiated (Charges)",
            nypd_allegation_disposition: "APU Guilty",
          },
        ]);
      }
      // 2fir-qns4 (officers)
      return jsonResponse([
        { tax_id: "942643", officer_first_name: "Alfred", officer_last_name: "Hernandez", shield_no: "05046" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([
      {
        complaintId: "201806447",
        complaintOfficerNumber: "1",
        allegationRecordIdentity: "240280",
        fadoType: "Force",
        allegation: "Physical force",
        ccrbDisposition: "Substantiated (Charges)",
        nypdDisposition: "APU Guilty",
        officerFirstName: "Alfred",
        officerLastName: "Hernandez",
        shieldNo: "05046",
        incidentDate: "2018-01-05",
      },
    ]);

    const complaintsUrl = urlFor(fetchMock, "2mby-ccnw");
    expect(complaintsUrl.searchParams.get("$where")).toMatch(/^close_date >= '\d{4}-\d{2}-\d{2}'$/);

    const allegationsUrl = urlFor(fetchMock, "6xgr-kwjq");
    expect(allegationsUrl.searchParams.get("$where")).toBe("complaint_id in('201806447')");

    const officersUrl = urlFor(fetchMock, "2fir-qns4");
    expect(officersUrl.searchParams.get("$where")).toBe("tax_id in('942643')");
  });

  it("follows $offset pagination on the Complaints fetch until a page returns fewer than PAGE_SIZE rows", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ complaint_id: String(i), incident_date: "2020-01-01" }));
    const shortPage = [{ complaint_id: "1000", incident_date: "2020-01-01" }];

    let complaintsCallCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        complaintsCallCount++;
        return jsonResponse(complaintsCallCount === 1 ? fullPage : shortPage);
      }
      return jsonResponse([]); // no allegations/officers in this fixture
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchNycCcrbAllegations();

    expect(complaintsCallCount).toBe(2);
    const secondCallUrl = urlFor(fetchMock, "2mby-ccnw", 1);
    expect(secondCallUrl.searchParams.get("$offset")).toBe("1000");
  });

  it("returns an empty result and skips both the allegations and officer fetch when there are no closed complaints in the window", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the Complaints call
  });

  it("returns an empty result and skips the officer fetch when there are complaints but no matching allegations", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "1", incident_date: "2020-01-01" }]);
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // Complaints + Allegations, no Officers call
  });

  it("skips an allegation row missing complaint_id, complaint_officer_number, or allegation_record_identity rather than throwing", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6", incident_date: "2020-01-01" }]);
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          { complaint_officer_number: "1", allegation_record_identity: "240280", fado_type: "Force", allegation: "No complaint id" },
          { complaint_id: "5", allegation_record_identity: "240281", fado_type: "Force", allegation: "No officer number" },
          { complaint_id: "7", complaint_officer_number: "1", fado_type: "Force", allegation: "No allegation record identity" },
          { complaint_id: "6", complaint_officer_number: "1", allegation_record_identity: "240282", fado_type: "Force", allegation: "Has all three" },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1);
    expect(allegations[0].complaintId).toBe("6");
  });

  it("sets incidentDate to null when the matching complaint has no incident_date", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6" }]); // no incident_date field at all
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          { complaint_id: "6", complaint_officer_number: "1", allegation_record_identity: "240282", fado_type: "Force", allegation: "x" },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1);
    expect(allegations[0].incidentDate).toBeNull();
  });

  it("sends the X-App-Token header on every request when an app token is provided, and omits it when not", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchNycCcrbAllegations({ appToken: "test-token" });
    const [, withTokenOptions] = fetchMock.mock.calls[0];
    expect(withTokenOptions.headers["X-App-Token"]).toBe("test-token");

    fetchMock.mockClear();
    await fetchNycCcrbAllegations();
    const [, withoutTokenOptions] = fetchMock.mock.calls[0];
    expect(withoutTokenOptions.headers["X-App-Token"]).toBeUndefined();
  });

  it("throws with a descriptive message on a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND data.cityofnewyork.us"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNycCcrbAllegations()).rejects.toThrow(/network error/i);
  });

  it("throws on a non-200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNycCcrbAllegations()).rejects.toThrow(/429/);
  });

  it("throws on a malformed (non-JSON) response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNycCcrbAllegations()).rejects.toThrow(/not valid JSON/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run --workspace apps/ingestion test -- nyc-ccrb/client`
Expected: FAIL — the new tests reference query patterns (`2mby-ccnw` Complaints calls) the current implementation never makes; `toEqual` assertions on the normalized shape fail because `incidentDate` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `apps/ingestion/src/nyc-ccrb/client.ts` with:

```ts
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
  /** From the Complaints join -- null if that complaint had no
   * incident_date on file (rare; run.ts surfaces a note when this
   * happens, since a date is required for review-queue approval). */
  incidentDate: string | null;
}

interface RawComplaintRow {
  complaint_id?: string;
  incident_date?: string;
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
    const params = new URLSearchParams();
    params.set("$where", `${field} in(${quoted})`);
    params.set("$limit", String(BATCH_SIZE));
    const url = `${BASE_URL}/${dataset}.json?${params.toString()}`;

    const rows = await fetchSocrataJson<T[]>(url, appToken);
    results.push(...rows);
  }
  return results;
}

/**
 * Fetches complaints closed within the trailing `sinceDays` window
 * (default 30), paginated via $limit/$offset until a page returns fewer
 * than PAGE_SIZE rows. This is the pipeline's actual incremental-window
 * source (see file-level comment) -- already-seen complaints are filtered
 * by hasBeenQueued in run.ts before any DB write, same as before.
 */
async function fetchClosedComplaints(sinceDays: number, appToken?: string): Promise<Map<string, string | null>> {
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const incidentDateByComplaintId = new Map<string, string | null>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    params.set("$where", `close_date >= '${sinceDate}'`);
    params.set("$select", "complaint_id,incident_date");
    params.set("$limit", String(PAGE_SIZE));
    params.set("$offset", String(page * PAGE_SIZE));
    const url = `${BASE_URL}/${COMPLAINTS_DATASET}.json?${params.toString()}`;

    const rows = await fetchSocrataJson<RawComplaintRow[]>(url, appToken);
    for (const row of rows) {
      if (row.complaint_id) {
        incidentDateByComplaintId.set(row.complaint_id, row.incident_date ?? null);
      }
    }
    if (rows.length < PAGE_SIZE) {
      break;
    }
  }
  return incidentDateByComplaintId;
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

  const incidentDateByComplaintId = await fetchClosedComplaints(sinceDays, options.appToken);
  const complaintIds = [...incidentDateByComplaintId.keys()];

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
    const normalized = normalizeAllegation(raw, officersByTaxId, incidentDateByComplaintId);
    if (normalized !== null) {
      results.push(normalized);
    }
  }
  return results;
}

function normalizeAllegation(
  raw: RawAllegationRow,
  officersByTaxId: Map<string, RawOfficerRow>,
  incidentDateByComplaintId: Map<string, string | null>,
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
    incidentDate: incidentDateByComplaintId.get(raw.complaint_id) ?? null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run --workspace apps/ingestion test -- nyc-ccrb/client`
Expected: PASS (10 tests).

- [ ] **Step 5: Live-verify the new query patterns against the real API**

This is the check that would have caught the original defect — don't skip it. Run each of these three commands and confirm the output shape matches what `client.ts` expects:

```bash
curl -s "https://data.cityofnewyork.us/resource/2mby-ccnw.json?\$where=close_date%20%3E%3D%20%272026-06-25%27&\$select=complaint_id,incident_date&\$limit=3"
curl -s "https://data.cityofnewyork.us/resource/6xgr-kwjq.json?\$where=complaint_id%20in(%27201806447%27)"
curl -s "https://data.cityofnewyork.us/resource/2fir-qns4.json?\$where=tax_id%20in(%27942643%27)"
```

Expected: all three return real JSON arrays (not an error body), the first with real `complaint_id`/`incident_date` pairs, matching the shapes `RawComplaintRow`/`RawAllegationRow`/`RawOfficerRow` expect.

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/client.ts apps/ingestion/test/nyc-ccrb/client.test.ts
git commit -m "Rework NYC CCRB client to a Complaints-first fetch

The original as_of_date filter on the Allegations dataset doesn't window
anything -- live-verified every one of its 430,011 rows shares one value
(a whole-table snapshot timestamp, not a per-row date). Complaints
(2mby-ccnw) has a genuine per-row close_date; querying it first (549
complaints/30-day window, live-verified) then batch-fetching matching
Allegations by complaint_id gives a properly bounded incremental fetch,
and supplies incident_date as a side effect (needed by Task 2)."
```

---

### Task 2: Wire `dateAsReported` into `run.ts`, update tests, and live re-verify

**Files:**
- Modify: `apps/ingestion/src/nyc-ccrb/run.ts`
- Modify: `apps/ingestion/test/nyc-ccrb/run.test.ts`

**Interfaces:**
- Consumes: `NycCcrbAllegation.incidentDate` from Task 1.
- Produces: nothing other tasks depend on — this is the last task in this plan.

- [ ] **Step 1: Write the failing tests**

In `apps/ingestion/test/nyc-ccrb/run.test.ts`, find:

```tsx
function allegation(overrides: Partial<NycCcrbAllegation> = {}): NycCcrbAllegation {
  return {
    complaintId: "201806447",
    complaintOfficerNumber: "1",
    allegationRecordIdentity: "240280",
    fadoType: "Force",
    allegation: "Physical force",
    ccrbDisposition: "Substantiated (Charges)",
    nypdDisposition: "APU Guilty",
    officerFirstName: "Alfred",
    officerLastName: "Hernandez",
    shieldNo: "05046",
    ...overrides,
  };
}
```

Replace with:

```tsx
function allegation(overrides: Partial<NycCcrbAllegation> = {}): NycCcrbAllegation {
  return {
    complaintId: "201806447",
    complaintOfficerNumber: "1",
    allegationRecordIdentity: "240280",
    fadoType: "Force",
    allegation: "Physical force",
    ccrbDisposition: "Substantiated (Charges)",
    nypdDisposition: "APU Guilty",
    officerFirstName: "Alfred",
    officerLastName: "Hernandez",
    shieldNo: "05046",
    incidentDate: "2018-01-05",
    ...overrides,
  };
}
```

Then find the first test's assertion block:

```tsx
    expect(reviewQueueRows.rows[0].proposed_record).toMatchObject({
      type: "incident_candidate",
      officerId,
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
    });
```

Replace with:

```tsx
    expect(reviewQueueRows.rows[0].proposed_record).toMatchObject({
      type: "incident_candidate",
      officerId,
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      date: "2018-01-05",
    });
```

Then add one new test. Find:

```tsx
  it("queues a low-confidence candidate with a note when no shield number is on file", async () => {
```

Insert immediately before it:

```tsx
  it("queues a candidate with a note (in addition to any other note) when the matched complaint had no incident date", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ incidentDate: null })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record FROM review_queue rq JOIN sources s ON s.id = rq.source_id WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].proposed_record.date).toBeUndefined();
    expect(reviewQueueRows.rows[0].proposed_record.note).toMatch(/no incident date/i);
  });

  it("queues a low-confidence candidate with a note when no shield number is on file", async () => {
```

- [ ] **Step 2: Run the tests to verify the new/changed ones fail**

Run: `npm run --workspace apps/ingestion test -- nyc-ccrb/run`
Expected: FAIL — the first test's `date: "2018-01-05"` assertion fails (currently `undefined`, since `run.ts` never sets `dateAsReported`); the new "no incident date" test fails (`note` doesn't match `/no incident date/i` since that note doesn't exist yet).

- [ ] **Step 3: Update the implementation**

In `apps/ingestion/src/nyc-ccrb/run.ts`, find:

```ts
      const note = !officerName
        ? "NYPD's CCRB roster did not return an officer name for this allegation's tax_id -- verify identity before approving."
        : !allegation.shieldNo
          ? "No shield number on file for this officer in NYPD's CCRB roster -- verify identity before approving."
          : undefined;

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
        note,
      };
```

Replace with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run --workspace apps/ingestion test -- nyc-ccrb/run`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full apps/ingestion suite to check for regressions**

Run: `npm run --workspace apps/ingestion test`
Expected: PASS (all files, including the untouched `courtlistener/*` suite).

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/run.ts apps/ingestion/test/nyc-ccrb/run.test.ts
git commit -m "Populate dateAsReported from the new Complaints join

Every NYC CCRB candidate was previously unapprovable through the normal
admin UI -- the approve endpoint requires a date and 400s without one,
and review-queue has no control to add a missing date at approval time.
Also adds a note when a matched complaint genuinely has no incident
date on file (rare), so a reviewer knows why approval will fail."
```

- [ ] **Step 7: Live re-verify the fixed pipeline end-to-end, and clean up the prior broken run's data**

This is the check the original pipeline skipped before shipping — don't skip it this time either.

First, clean up the ~50,000 rows the pre-fix broken run queued into the local dev database (they're not real incremental output, just an artifact of hitting the old hard cap):

```bash
docker exec cop-db-1 psql -U cop -d cop -c "DELETE FROM review_queue WHERE source_id IN (SELECT id FROM sources WHERE source_type = 'official_dataset')"
docker exec cop-db-1 psql -U cop -d cop -c "DELETE FROM sources WHERE source_type = 'official_dataset'"
docker exec cop-db-1 psql -U cop -d cop -c "DELETE FROM ingestion_runs WHERE source_type = 'nyc_ccrb'"
```

Then rebuild and re-run the real pipeline against the live API and local Postgres (the `ingestion_configs` row for `nyc_ccrb` should already exist from the earlier smoke test — confirm with `docker exec cop-db-1 psql -U cop -d cop -c "SELECT id, config FROM ingestion_configs WHERE source_type = 'nyc_ccrb'"` and insert one if it's missing, using the same config shape as `docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md` §6):

```bash
npm run --workspace packages/shared-types build
npm run --workspace packages/ingestion-lib build
DATABASE_URL="postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop" npm run --workspace apps/ingestion ingest:nyc-ccrb
```

Then check the real result:

```bash
docker exec cop-db-1 psql -U cop -d cop -c "SELECT source_type, items_fetched, items_queued, items_deduped, error, finished_at FROM ingestion_runs WHERE source_type = 'nyc_ccrb' ORDER BY started_at DESC LIMIT 1"
docker exec cop-db-1 psql -U cop -d cop -c "SELECT rq.proposed_record->>'date' AS date, rq.proposed_record->>'shortDescription' AS short_description FROM review_queue rq JOIN sources s ON s.id = rq.source_id WHERE s.source_type = 'official_dataset' LIMIT 5"
```

Expected: `items_fetched` in the low thousands (not 50,000 — the live-verified 549-complaint/30-day window times roughly 2-3 allegations/complaint), `error` is null, and every sampled `date` value is a real non-null date string (not empty) — confirming the fix actually works against live data, not just the mocked tests.
