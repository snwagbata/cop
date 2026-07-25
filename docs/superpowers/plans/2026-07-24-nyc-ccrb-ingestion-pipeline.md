# NYC CCRB Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build INGESTION_DESIGN.md §3.2's ingestion pipeline pilot against NYC's real CCRB (Civilian Complaint Review Board) Socrata open-data API — a structured, no-LLM-needed source with verified officer identity, fetching allegations, joining officer name/shield by tax_id, and queuing each as a `review_queue` candidate via the same common pipeline shape the federal CourtListener pipeline already established.

**Architecture:** New `apps/ingestion/src/nyc-ccrb/` module (`client.ts` for the Socrata fetch+join, `run.ts` for orchestration), reusing `packages/ingestion-lib`'s existing `hasBeenQueued`/`matchOfficer`/`queueCandidate`/`startRun`/`finishRun` exactly as `courtlistener/run.ts` does. One new seed file adds the real NYPD department row `matchOfficer` needs to resolve against. One new GitHub Actions workflow runs it weekly, reusing the existing `INGESTION_DATABASE_URL` secret (no new required secrets).

**Tech Stack:** TypeScript, `pg`, Vitest, native `fetch` (no HTTP client dependency, matching `courtlistener/client.ts`'s convention) — no new npm dependencies.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md` — read for full context; this plan's tasks implement it exactly.
- `sourceType` is `"official_dataset"` (not `"decertification_registry"`) — verified against `packages/shared-types/src/index.ts`'s real `SourceType` union.
- `reliabilityTier` is `"tier2_official_dataset"` — verified against the real `ReliabilityTier` union.
- `incidentType` is `"use_of_force"` only when `fado_type === "Force"`; every other `fado_type` value maps to `"other"` — verified against the real `IncidentType` union, which has no categories for CCRB's other three FADO types (Abuse of Authority, Discourtesy, Offensive Language).
- No `postCertificationIdAsReported` is ever set from NYPD's `shield_no` — different ID namespace than a state POST-issued `post_certification_id`; conflating them would be a correctness bug.
- The new department seed row (`db/seed/0002_nyc_pilot_department.sql`) is the **only** real (non-fictional) data added anywhere in this plan — no real officer/incident/outcome rows, matching `DEPLOYMENT.md`'s "no real officer data in this demo instance" constraint.
- All three SoQL query patterns this plan uses (`$where` date filter, `$offset` pagination, `$where tax_id in(...)` batch join) were live-verified against the real `data.cityofnewyork.us` API during this plan's design — unlike the CourtListener pipeline, nothing here ships with an "unverified contract" warning.

---

### Task 1: Seed the real NYPD department row

**Files:**
- Create: `db/seed/0002_nyc_pilot_department.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a `departments` row with fixed id `00000000-0000-0000-0000-000000000003` and name `New York City Police Department`, which Task 3's pipeline config and Task 3's tests both reference by that exact name (case-insensitive exact match, per `matchOfficer`'s `d.name ILIKE $2`).

- [ ] **Step 1: Write the seed file**

Create `db/seed/0002_nyc_pilot_department.sql`:

```sql
-- Real department, unlike 0001's fictional Springfield/Shelbyville rows --
-- added specifically to let the NYC CCRB ingestion pipeline
-- (INGESTION_DESIGN.md §3.2, docs/superpowers/specs/2026-07-24-nyc-ccrb-
-- ingestion-pipeline-design.md) resolve a department match. This is a
-- public entity (a city police department's existence is not sensitive
-- data), not officer data -- no real officer/incident/outcome rows are
-- seeded here or anywhere else in this repo. DEPLOYMENT.md's "don't
-- deploy real officer data" constraint is about officer-level records,
-- which this does not add.

BEGIN;

-- Fixed UUID, matching 0001_synthetic_sample_data.sql's convention (its
-- departments use ...0001/...0002) -- the next one in that same sequence.
INSERT INTO departments (id, name, state, jurisdiction_type, contact_info, records_request_portal_url) VALUES
    ('00000000-0000-0000-0000-000000000003', 'New York City Police Department', 'NY', 'municipal', NULL,
        'https://a860-openrecords.nyc.gov/');

COMMIT;
```

- [ ] **Step 2: Apply it to the local dev database and verify**

Run: `DATABASE_URL="postgres://cop:cop_dev_only@localhost:5432/cop" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed/0002_nyc_pilot_department.sql`

(If the local dev database was already fully seeded via `db/seed.sh` before this file existed, running this file alone is correct and sufficient — `db/seed.sh` itself needs no changes since it already globs every file under `db/seed/*.sql` in order.)

Then verify: `psql "postgres://cop:cop_dev_only@localhost:5432/cop" -c "SELECT id, name, state FROM departments WHERE id = '00000000-0000-0000-0000-000000000003'"`

Expected: one row, `New York City Police Department`, `NY`.

- [ ] **Step 3: Commit**

```bash
git add db/seed/0002_nyc_pilot_department.sql
git commit -m "Seed the real NYPD department row for the CCRB pipeline

Public entity only (a department's existence isn't sensitive) -- no real
officer/incident data added. Needed because matchOfficer requires an
exact departments.name match and this instance's only seeded departments
were the fictional Springfield/Shelbyville ones."
```

---

### Task 2: NYC CCRB Socrata client (`client.ts`)

**Files:**
- Create: `apps/ingestion/src/nyc-ccrb/client.ts`
- Test: `apps/ingestion/test/nyc-ccrb/client.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure HTTP client, no DB).
- Produces: `fetchNycCcrbAllegations(options?: { sinceDays?: number; appToken?: string }): Promise<NycCcrbAllegation[]>` and the `NycCcrbAllegation` interface (`complaintId: string`, `complaintOfficerNumber: string`, `fadoType: string`, `allegation: string`, `ccrbDisposition: string | null`, `nypdDisposition: string | null`, `officerFirstName: string | null`, `officerLastName: string | null`, `shieldNo: string | null`) — Task 3's `run.ts` imports both.

- [ ] **Step 1: Write the failing tests**

Create `apps/ingestion/test/nyc-ccrb/client.test.ts`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNycCcrbAllegations } from "../../src/nyc-ccrb/client.js";

/**
 * Mocked-HTTP tests for the NYC CCRB Socrata client. Unlike
 * courtlistener/client.ts, every query pattern asserted here (`$where`
 * date filter, `$offset` pagination, `$where tax_id in(...)` batch join)
 * was live-verified against the real data.cityofnewyork.us API during
 * this pipeline's design -- see
 * docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md.
 */

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });
}

describe("fetchNycCcrbAllegations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches allegations and joins officer identity by tax_id", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          {
            complaint_id: "201806447",
            complaint_officer_number: "1",
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
        {
          tax_id: "942643",
          officer_first_name: "Alfred",
          officer_last_name: "Hernandez",
          shield_no: "05046",
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([
      {
        complaintId: "201806447",
        complaintOfficerNumber: "1",
        fadoType: "Force",
        allegation: "Physical force",
        ccrbDisposition: "Substantiated (Charges)",
        nypdDisposition: "APU Guilty",
        officerFirstName: "Alfred",
        officerLastName: "Hernandez",
        shieldNo: "05046",
      },
    ]);

    // Officer join batched the one tax_id found in the allegations page.
    const officerCall = fetchMock.mock.calls.find(([url]: [string]) => url.includes("2fir-qns4"));
    expect(officerCall).toBeDefined();
    const officerUrl = new URL(officerCall![0]);
    expect(officerUrl.searchParams.get("$where")).toBe("tax_id in('942643')");
  });

  it("follows $offset pagination until a page returns fewer than PAGE_SIZE rows", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      complaint_id: String(i),
      complaint_officer_number: "1",
      fado_type: "Discourtesy",
      allegation: "Action",
    }));
    const shortPage = [{ complaint_id: "1000", complaint_officer_number: "1", fado_type: "Discourtesy", allegation: "Action" }];

    let allegationCallCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("6xgr-kwjq")) {
        allegationCallCount++;
        return jsonResponse(allegationCallCount === 1 ? fullPage : shortPage);
      }
      return jsonResponse([]); // no tax_ids in this fixture, officer join returns nothing
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1001);
    expect(allegationCallCount).toBe(2);
    const secondCallUrl = new URL(fetchMock.mock.calls.filter(([url]: [string]) => url.includes("6xgr-kwjq"))[1][0]);
    expect(secondCallUrl.searchParams.get("$offset")).toBe("1000");
  });

  it("returns an empty result and skips the officer fetch entirely when there are no allegations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the allegations call, no officer join call
  });

  it("skips an allegation row missing complaint_id or complaint_officer_number rather than throwing", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          { complaint_officer_number: "1", fado_type: "Force", allegation: "No complaint id" },
          { complaint_id: "5", fado_type: "Force", allegation: "No officer number" },
          { complaint_id: "6", complaint_officer_number: "1", fado_type: "Force", allegation: "Has both" },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1);
    expect(allegations[0].complaintId).toBe("6");
  });

  it("sends the X-App-Token header when an app token is provided, and omits it when not", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
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
Expected: FAIL — `Cannot find module '../../src/nyc-ccrb/client.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/ingestion/src/nyc-ccrb/client.ts`:

```ts
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
  /** Together with complaintOfficerNumber, this pipeline's dedup key
   * (INGESTION_DESIGN.md §2's external_ref). */
  complaintId: string;
  complaintOfficerNumber: string;
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
  if (!raw.complaint_id || !raw.complaint_officer_number) {
    // No stable composite id -- can't dedupe this row. Skip rather than
    // throw, same defensive-parsing convention as courtlistener/client.ts.
    return null;
  }

  const officer = raw.tax_id ? officersByTaxId.get(raw.tax_id) : undefined;

  return {
    complaintId: raw.complaint_id,
    complaintOfficerNumber: raw.complaint_officer_number,
    fadoType: raw.fado_type ?? "Unknown",
    allegation: raw.allegation ?? "Unknown",
    ccrbDisposition: raw.ccrb_allegation_disposition ?? null,
    nypdDisposition: raw.nypd_allegation_disposition ?? null,
    officerFirstName: officer?.officer_first_name ?? null,
    officerLastName: officer?.officer_last_name ?? null,
    shieldNo: officer?.shield_no ?? null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run --workspace apps/ingestion test -- nyc-ccrb/client`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/client.ts apps/ingestion/test/nyc-ccrb/client.test.ts
git commit -m "Add NYC CCRB Socrata client

Fetches allegations in a trailing date window, paginated, joined to
officer name/shield by tax_id in batches. Every query pattern here was
live-verified against the real API during this pipeline's design."
```

---

### Task 3: Pipeline orchestration (`run.ts`) + wiring

**Files:**
- Create: `apps/ingestion/src/nyc-ccrb/run.ts`
- Modify: `apps/ingestion/src/index.ts`
- Modify: `apps/ingestion/package.json`
- Modify: `apps/ingestion/test/support/reset.ts`
- Modify: `apps/ingestion/test/support/seed-ids.ts`
- Test: `apps/ingestion/test/nyc-ccrb/run.test.ts`

**Interfaces:**
- Consumes: `fetchNycCcrbAllegations`/`NycCcrbAllegation` from Task 2; `hasBeenQueued`/`matchOfficer`/`queueCandidate`/`startRun`/`finishRun`/`CandidateItem` from `@cop/ingestion-lib` (already built, unchanged); the department row from Task 1 (`00000000-0000-0000-0000-000000000003`, name `New York City Police Department`).
- Produces: `runNycCcrbPipeline(pool, env, deps?): Promise<void>` — `apps/ingestion/src/index.ts`'s CLI dispatch calls this for `pipeline === "nyc_ccrb"`.

- [ ] **Step 1: Add the NYPD department to this package's own test seed baseline**

`apps/ingestion/test/support/reset.ts` currently loads only `0001_synthetic_sample_data.sql`. This task's tests need Task 1's department row too, but **only within apps/ingestion's own isolated test database** (`cop_test_courtlistener`) — this change must not touch any other suite's `reset.ts` (`packages/ingestion-lib`, `packages/db-tests`, `apps/api-public`, `apps/api-internal` each hardcode their own read of `0001_synthetic_sample_data.sql` independently and are unaffected by this file).

In `apps/ingestion/test/support/reset.ts`, replace:

```ts
const SEED_SQL_PATH = path.join(REPO_ROOT, "db", "seed", "0001_synthetic_sample_data.sql");
```

with:

```ts
const SEED_SQL_PATHS = [
  path.join(REPO_ROOT, "db", "seed", "0001_synthetic_sample_data.sql"),
  path.join(REPO_ROOT, "db", "seed", "0002_nyc_pilot_department.sql"),
];
```

And replace the `loadSeedSql` function:

```ts
let cachedSeedSql: string | null = null;
function loadSeedSql(): string {
  if (cachedSeedSql === null) {
    cachedSeedSql = readFileSync(SEED_SQL_PATH, "utf8");
  }
  return cachedSeedSql;
}
```

with:

```ts
let cachedSeedSql: string | null = null;
function loadSeedSql(): string {
  if (cachedSeedSql === null) {
    cachedSeedSql = SEED_SQL_PATHS.map((p) => readFileSync(p, "utf8")).join("\n");
  }
  return cachedSeedSql;
}
```

- [ ] **Step 2: Add the NYPD department to this package's own seed-ids reference**

In `apps/ingestion/test/support/seed-ids.ts`, find:

```ts
    shelbyville: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Shelbyville Police Department (fictional)",
    },
  },
  officers: {
```

Replace with:

```ts
    shelbyville: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Shelbyville Police Department (fictional)",
    },
    nyc: {
      id: "00000000-0000-0000-0000-000000000003",
      name: "New York City Police Department",
    },
  },
  officers: {
```

- [ ] **Step 3: Write the failing tests**

Create `apps/ingestion/test/nyc-ccrb/run.test.ts`:

```tsx
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { runNycCcrbPipeline } from "../../src/nyc-ccrb/run.js";
import type { NycCcrbAllegation } from "../../src/nyc-ccrb/client.js";

const ENV = {};

function allegation(overrides: Partial<NycCcrbAllegation> = {}): NycCcrbAllegation {
  return {
    complaintId: "201806447",
    complaintOfficerNumber: "1",
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

async function insertConfig(pool: Pool, config: { departmentName: string }, enabled = true): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', $1, $2) RETURNING id`,
    [enabled, JSON.stringify(config)],
  );
  return result.rows[0].id;
}

describe("runNycCcrbPipeline", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("takes a clean candidate end-to-end into review_queue, matching an existing NYPD officer", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    // Test-local officer row (deliberately not in seed data -- per the
    // design doc, real NYPD officers are meant to arrive via reviewer
    // approval, not seed data; this row exists only so this one test can
    // exercise the 'medium'-confidence match path).
    const officerResult = await pool.query<{ id: string }>(
      `INSERT INTO officers (first_name, last_name, department_id) VALUES ('Alfred', 'Hernandez', $1) RETURNING id`,
      [SEED.departments.nyc.id],
    );
    const officerId = officerResult.rows[0].id;

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    expect(fetchNycCcrbAllegations).toHaveBeenCalledWith({ appToken: undefined });

    const sourceRows = await pool.query(
      `SELECT source_type, reliability_tier, external_ref FROM sources WHERE external_ref = '201806447:1'`,
    );
    expect(sourceRows.rows).toHaveLength(1);
    expect(sourceRows.rows[0]).toMatchObject({
      source_type: "official_dataset",
      reliability_tier: "tier2_official_dataset",
      external_ref: "201806447:1",
    });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence, rq.status
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:1'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].status).toBe("pending");
    expect(reviewQueueRows.rows[0].match_confidence).toBe("medium");
    expect(reviewQueueRows.rows[0].proposed_record).toMatchObject({
      type: "incident_candidate",
      officerId,
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
    });

    const runRows = await pool.query(
      `SELECT source_type, items_fetched, items_queued, items_deduped, error, finished_at FROM ingestion_runs`,
    );
    expect(runRows.rows).toHaveLength(1);
    expect(runRows.rows[0]).toMatchObject({
      source_type: "nyc_ccrb",
      items_fetched: 1,
      items_queued: 1,
      items_deduped: 0,
      error: null,
    });
    expect(runRows.rows[0].finished_at).not.toBeNull();
  });

  it("skips an allegation already queued from a prior run (dedup via external_ref)", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const priorSource = await pool.query<{ id: string }>(
      `INSERT INTO sources (source_type, reliability_tier, external_ref)
       VALUES ('official_dataset', 'tier2_official_dataset', '201806447:1')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status)
       VALUES ($1, $2, 'low', 'pending')`,
      [
        JSON.stringify({
          type: "incident_candidate",
          departmentName: SEED.departments.nyc.name,
          incidentType: "use_of_force",
          shortDescription: "Pre-existing candidate from a prior run.",
        }),
        priorSource.rows[0].id,
      ],
    );

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const sourceRows = await pool.query(`SELECT id FROM sources WHERE external_ref = '201806447:1'`);
    expect(sourceRows.rows).toHaveLength(1); // still just the one from setup

    const runRows = await pool.query(`SELECT items_fetched, items_queued, items_deduped FROM ingestion_runs`);
    expect(runRows.rows[0]).toMatchObject({ items_fetched: 1, items_queued: 0, items_deduped: 1 });
  });

  it("queues a low-confidence candidate with a note when no shield number is on file", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ shieldNo: null })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:1'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].match_confidence).toBe("low"); // no officers table row exists to match against
    expect(reviewQueueRows.rows[0].proposed_record.note).toMatch(/no shield number/i);
  });

  it("queues a low-confidence candidate with a different note when no officer name was returned at all", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi
      .fn()
      .mockResolvedValue([allegation({ officerFirstName: null, officerLastName: null, shieldNo: null })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record FROM review_queue rq JOIN sources s ON s.id = rq.source_id WHERE s.external_ref = '201806447:1'`,
    );
    expect(reviewQueueRows.rows[0].proposed_record.note).toMatch(/did not return an officer name/i);
    expect(reviewQueueRows.rows[0].proposed_record.officerName).toBeUndefined();
  });

  it("isolates one config row's failure -- other rows still run", async () => {
    const failingConfigId = await insertConfig(pool, { departmentName: "Some Other Department" });
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    let callCount = 0;
    const fetchNycCcrbAllegations = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("NYC CCRB request failed: 500 Internal Server Error");
      }
      return [allegation({ complaintId: "999", complaintOfficerNumber: "1" })];
    });

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    expect(fetchNycCcrbAllegations).toHaveBeenCalledTimes(2);

    const failedRun = await pool.query(
      `SELECT items_fetched, error, finished_at FROM ingestion_runs ORDER BY started_at ASC LIMIT 1`,
    );
    expect(failedRun.rows[0].error).toMatch(/500 Internal Server Error/);
    expect(failedRun.rows[0].finished_at).not.toBeNull();

    const succeededRun = await pool.query(
      `SELECT items_fetched, items_queued, error FROM ingestion_runs ORDER BY started_at ASC OFFSET 1 LIMIT 1`,
    );
    expect(succeededRun.rows[0]).toMatchObject({ items_fetched: 1, items_queued: 1, error: null });

    const configRows = await pool.query(`SELECT last_run_at FROM ingestion_configs WHERE id = $1`, [failingConfigId]);
    expect(configRows.rows[0].last_run_at).not.toBeNull();
  });

  it("skips disabled config rows entirely", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name }, false);

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    expect(fetchNycCcrbAllegations).not.toHaveBeenCalled();
    const runRows = await pool.query(`SELECT id FROM ingestion_runs`);
    expect(runRows.rows).toHaveLength(0);
  });

  it("skips a config row whose config JSON doesn't match the expected shape, without crashing the whole pipeline", async () => {
    await pool.query(`INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', true, $1)`, [
      JSON.stringify({ notTheRightShape: true }),
    ]);
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    expect(fetchNycCcrbAllegations).toHaveBeenCalledTimes(1);
    const runRows = await pool.query(`SELECT id FROM ingestion_runs`);
    expect(runRows.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run --workspace apps/ingestion test -- nyc-ccrb/run`
Expected: FAIL — `Cannot find module '../../src/nyc-ccrb/run.js'`.

- [ ] **Step 5: Write the implementation**

Create `apps/ingestion/src/nyc-ccrb/run.ts`:

```ts
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
      const externalRef = `${allegation.complaintId}:${allegation.complaintOfficerNumber}`;
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
```

- [ ] **Step 6: Wire the new pipeline into the CLI entry point**

In `apps/ingestion/src/index.ts`, find:

```ts
import pg from "pg";
import { runCourtListenerPipeline } from "./courtlistener/run.js";
```

Replace with:

```ts
import pg from "pg";
import { runCourtListenerPipeline } from "./courtlistener/run.js";
import { runNycCcrbPipeline } from "./nyc-ccrb/run.js";
```

Then find:

```ts
  if (pipeline === "courtlistener") {
    const courtListenerApiKey = requireEnv("COURTLISTENER_API_KEY");
    const anthropicApiKey = requireEnv("ANTHROPIC_API_KEY");

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runCourtListenerPipeline(pool, { courtListenerApiKey, anthropicApiKey });
    } finally {
      await pool.end();
    }
    return;
  }

  throw new Error(`Unknown pipeline: "${pipeline}". Known pipelines: courtlistener.`);
```

Replace with:

```ts
  if (pipeline === "courtlistener") {
    const courtListenerApiKey = requireEnv("COURTLISTENER_API_KEY");
    const anthropicApiKey = requireEnv("ANTHROPIC_API_KEY");

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runCourtListenerPipeline(pool, { courtListenerApiKey, anthropicApiKey });
    } finally {
      await pool.end();
    }
    return;
  }

  if (pipeline === "nyc_ccrb") {
    // SOCRATA_APP_TOKEN is read directly (not via requireEnv) since it's
    // optional -- process.env.SOCRATA_APP_TOKEN is undefined when unset,
    // exactly the value NycCcrbRunEnv.socrataAppToken expects for "no
    // token provided."
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runNycCcrbPipeline(pool, { socrataAppToken: process.env.SOCRATA_APP_TOKEN });
    } finally {
      await pool.end();
    }
    return;
  }

  throw new Error(`Unknown pipeline: "${pipeline}". Known pipelines: courtlistener, nyc_ccrb.`);
```

- [ ] **Step 7: Add npm scripts**

In `apps/ingestion/package.json`, find:

```json
    "ingest:courtlistener": "tsx src/index.ts courtlistener",
    "ingest:courtlistener:built": "node dist/src/index.js courtlistener",
    "test": "vitest run"
```

Replace with:

```json
    "ingest:courtlistener": "tsx src/index.ts courtlistener",
    "ingest:courtlistener:built": "node dist/src/index.js courtlistener",
    "ingest:nyc-ccrb": "tsx src/index.ts nyc_ccrb",
    "ingest:nyc-ccrb:built": "node dist/src/index.js nyc_ccrb",
    "test": "vitest run"
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run --workspace apps/ingestion test -- nyc-ccrb/run`
Expected: PASS (7 tests).

- [ ] **Step 9: Run the full apps/ingestion test suite to check for regressions**

Run: `npm run --workspace apps/ingestion test`
Expected: PASS (all files, including the existing `courtlistener/*` suite, which is unaffected by this task's `reset.ts`/`seed-ids.ts` additions since it only reads the `springfield`/`shelbyville` keys it already used).

- [ ] **Step 10: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/run.ts apps/ingestion/src/index.ts apps/ingestion/package.json apps/ingestion/test/nyc-ccrb/run.test.ts apps/ingestion/test/support/reset.ts apps/ingestion/test/support/seed-ids.ts
git commit -m "Add NYC CCRB pipeline orchestration and wire it into the CLI

No extraction/LLM step -- CCRB data is already structured. Reuses
packages/ingestion-lib's hasBeenQueued/matchOfficer/queueCandidate/
startRun/finishRun exactly as the CourtListener pipeline does."
```

---

### Task 4: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/ingest-nyc-ccrb.yml`

**Interfaces:**
- Consumes: `apps/ingestion`'s `npm run ingest:nyc-ccrb` script (Task 3); the existing `INGESTION_DATABASE_URL` repo secret (already exists — set up for the CourtListener workflow, same target database/role).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/ingest-nyc-ccrb.yml`:

```yaml
name: Ingest — NYC CCRB (civilian complaint review board)

# INGESTION_DESIGN.md §3.2 (pivoted from a state decertification registry
# to a city civilian-complaint-review source -- see
# docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md
# for why) and §1's cost philosophy: GitHub Actions scheduled workflows
# are the $0 compute layer every ingestion pipeline runs on.
#
# Unlike ingest-courtlistener.yml, this pipeline needs no new required
# secret -- NYC's Socrata API is free and unauthenticated at this
# pipeline's actual volume (weekly, one department). SOCRATA_APP_TOKEN
# below is optional (raises Socrata's rate-limit ceiling if ever needed);
# the workflow runs correctly whether or not that secret is set, since
# apps/ingestion/src/index.ts reads it as plain process.env access, not
# through requireEnv.
#
# Weekly cadence, same as ingest-courtlistener.yml -- this is a
# once-a-week snapshot poll, not a real-time feed. workflow_dispatch
# included for on-demand runs, same convention as every other workflow in
# this directory.
on:
  schedule:
    # Mondays, 07:00 UTC -- one hour after the CourtListener workflow's
    # 06:00 slot, so the two never contend for the same runner minute.
    - cron: "0 7 * * 1"
  workflow_dispatch: {}

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      # apps/ingestion depends on @cop/ingestion-lib and @cop/shared-types
      # by their built dist/ output, not by source -- both must be built
      # first, same as ingest-courtlistener.yml.
      - name: Build @cop/shared-types
        run: npm run --workspace packages/shared-types build

      - name: Build @cop/ingestion-lib
        run: npm run --workspace packages/ingestion-lib build

      - name: Run NYC CCRB ingestion
        env:
          # Same secret, same target database/role as
          # ingest-courtlistener.yml -- see that workflow's own comment
          # for why this is a distinct name from DATABASE_URL.
          DATABASE_URL: ${{ secrets.INGESTION_DATABASE_URL }}
          SOCRATA_APP_TOKEN: ${{ secrets.SOCRATA_APP_TOKEN }}
        run: npm run --workspace apps/ingestion ingest:nyc-ccrb

      - name: Job summary
        if: always()
        run: |
          {
            echo "### NYC CCRB ingestion run"
            echo ""
            echo "Per-config-row detail (fetched/queued/deduped/errors) is in \`ingestion_runs\`"
            echo "-- see the admin app's Ingestion Runs page, or query directly:"
            echo ""
            echo '```sql'
            echo "SELECT source_type, started_at, finished_at, items_fetched, items_queued, items_deduped, error"
            echo "FROM ingestion_runs WHERE source_type = 'nyc_ccrb' ORDER BY started_at DESC LIMIT 10;"
            echo '```'
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 2: Verify the YAML indentation**

Run: `git diff .github/workflows/ingest-nyc-ccrb.yml` (this is a new file, so the diff shows the whole thing) and visually confirm indentation is consistent 2-space nesting throughout, matching `.github/workflows/ingest-courtlistener.yml`'s existing structure exactly (job → steps → each step's keys).

Expected: structure mirrors `ingest-courtlistener.yml` with only the name, cron time, build/run steps, and env vars differing as described above.

- [ ] **Step 3: Note the optional secret for the human operator**

This step has no file change — it's a reminder for whoever has Render/GitHub dashboard access (not something this plan's implementer can do from this environment): if NYC's unauthenticated Socrata rate limit ever becomes a real constraint, add a free `SOCRATA_APP_TOKEN` from `data.cityofnewyork.us`'s developer settings as a new repo secret. Until then, the workflow runs correctly with that secret unset (empty string passed through, which `client.ts`'s `options.appToken` treats as falsy).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ingest-nyc-ccrb.yml
git commit -m "Add weekly GitHub Actions workflow for the NYC CCRB pipeline

Reuses the existing INGESTION_DATABASE_URL secret -- no new required
secret, since NYC's Socrata API is free and unauthenticated at this
pipeline's actual volume. SOCRATA_APP_TOKEN is an optional lever."
```
