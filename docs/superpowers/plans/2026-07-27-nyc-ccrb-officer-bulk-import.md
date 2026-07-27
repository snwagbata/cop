# NYC CCRB Officer Bulk-Import + Pipeline Officer-Resolution Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give NYC CCRB officer identity a real home in `officers` (bulk-imported from CCRB's own 97,551-row roster dataset), fix the weekly ingestion pipeline to resolve officers against it instead of always landing on `officerId: null`, and backfill the 2,231 items already stuck in `review_queue` from the first real production run.

**Architecture:** A new nullable `officers.external_officer_ref` column (namespaced `"nyc_ccrb:<tax_id>"`) is the stable cross-run identity key. A one-time bulk-import script populates it from CCRB's full Officers dataset using batched multi-row inserts (not the existing one-row-per-transaction pattern, which does not scale to 97,551 rows). The weekly pipeline (`run.ts`) then resolves each allegation's officer by that key first, falling back to the existing `matchOfficer` fuzzy path and, rarely, to on-the-spot creation. A second one-time script backfills the already-queued `review_queue` rows once real officers exist to point at.

**Tech Stack:** No new dependencies. Existing `pg`, `vitest`, Socrata JSON HTTP client already in `apps/ingestion`.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-27-nyc-ccrb-officer-bulk-import-design.md`.
- Never reuse the existing one-row-per-transaction pattern (`apps/ingestion/src/nyc-ccrb/run.ts`'s main loop) for the bulk import — batch via `unnest()`-based multi-row inserts instead (see design doc §2 for why: ~14 minutes for 2,231 rows one-at-a-time would mean days for 97,551).
- Never stamp `external_officer_ref` onto an officer resolved only via `matchOfficer`'s fuzzy name+department match (`'medium'` confidence). Only a tax-id hit (existing `external_officer_ref` lookup) or a fresh creation from CCRB's own roster data may set it. This is deliberate — promoting an ambiguous fuzzy match into a permanent hard identity link would compound a wrong guess into every future run.
- `record_revisions.changed_by = NULL` for every pipeline-authored officer creation (bulk import and the weekly pipeline's rare create-on-miss path alike) — nullable per migration 0011, represents system/pipeline authorship, not a human reviewer.
- `employment_status` mapping from CCRB's `active_per_last_reported_status` field: `"Yes"` → `'active'`; anything else, including the field being absent, → `'inactive'`. Never default to `'active'` unconditionally.
- Every task's verification **must include `npm run --workspace apps/ingestion lint`** (`tsc --noEmit`), not just `test` — this project has been bitten before by a plan that verified only build/test and let a real TypeScript regression reach CI (React 19 sub-project, this repo's own history).
- Officer records created by this feature (bulk import or pipeline create-on-miss) are immediately public via the existing officer search/detail APIs — no new visibility gate. Confirmed with the user; see design doc §2.
- Task order below is sequential, not parallel — Task 2 depends on Task 1's column existing in the test databases; Tasks 3-5 depend on Task 2's `client.ts` changes; Task 5 depends on Task 3 having actually run against whichever database it targets.

---

### Task 1: Migration — `officers.external_officer_ref`

**Files:**
- Create: `db/migrations/0020_officer_external_ref.sql`
- Modify: `packages/db-tests/src/tests/role-grants.test.ts`
- Create: `packages/db-tests/src/tests/officer-external-ref-uniqueness.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `officers.external_officer_ref` (nullable `text`, partial unique index) — every later task in this plan reads/writes this column.

- [ ] **Step 1: Write the migration**

Create `db/migrations/0020_officer_external_ref.sql`:

```sql
-- INGESTION_DESIGN.md's officer-identity gap: NYC CCRB (and any future
-- department/source with its own stable per-officer id) needs a way to
-- recognize "this officer was already created from source X's row Y"
-- across separate ingestion runs, without re-creating a duplicate officer
-- every time. Generic and namespaced (e.g. "nyc_ccrb:<tax_id>"), mirroring
-- sources.external_ref's own namespacing-by-source convention (migration
-- 0019) -- deliberately not reusing post_certification_id (a *state* POST
-- decertification id, a different concept) or badge_number (a real
-- public-facing shield number reviewers see on the officer page).
--
-- No new grant needed: migration 0015's
-- `GRANT SELECT, INSERT, UPDATE ON officers, record_revisions, ... TO
-- cop_internal_api` already covers all columns of officers, including ones
-- added later via ALTER TABLE -- verified against a real cop_internal_api
-- connection by this migration's own test suite (see
-- packages/db-tests/src/tests/officer-external-ref-uniqueness.test.ts).
ALTER TABLE officers ADD COLUMN external_officer_ref text;

CREATE UNIQUE INDEX officers_external_officer_ref_idx
    ON officers (external_officer_ref)
    WHERE external_officer_ref IS NOT NULL;
```

- [ ] **Step 2: Apply the migration to every local Postgres database that needs it**

```bash
DATABASE_URL="postgres://cop:cop_dev_only@localhost:5432/cop" ./db/migrate.sh
DATABASE_URL="postgres://cop:cop_dev_only@localhost:5432/cop_test" ./db/migrate.sh
DATABASE_URL="postgres://cop:cop_dev_only@localhost:5432/cop_test_courtlistener" ./db/migrate.sh
```

(`cop_test` is `packages/db-tests`'s and most other suites' database;
`cop_test_courtlistener` is `apps/ingestion`'s own dedicated database per
`apps/ingestion/test/support/connections.ts` — see `db/TESTING.md`. If
either database doesn't exist yet locally, create it first: `createdb
cop_test_courtlistener` / `createdb cop_test`, matching `db/TESTING.md`'s
documented one-time setup.)

Expected: `==> Applying 0020_officer_external_ref.sql` then `==> Migrations
complete.` for all three, no errors.

- [ ] **Step 3: Add a grant-check test to `role-grants.test.ts`**

In `packages/db-tests/src/tests/role-grants.test.ts`, inside the
`describe("cop_internal_api", ...)` block, add this test right after the
existing `"can INSERT into review_queue"` test:

```typescript
    it("can INSERT and SELECT officers.external_officer_ref (migration 0020 — no new grant needed, column added to an already-granted table)", async () => {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
         VALUES ('Grant', 'Check', $1, 'active', 'nyc_ccrb:grant-check-tax-id') RETURNING id`,
        [SEED.departments.springfield],
      );
      expect(inserted.rowCount).toBe(1);

      const selected = await pool.query<{ external_officer_ref: string }>(
        `SELECT external_officer_ref FROM officers WHERE id = $1`,
        [inserted.rows[0].id],
      );
      expect(selected.rows[0].external_officer_ref).toBe("nyc_ccrb:grant-check-tax-id");
    });
```

**Important:** `packages/db-tests`'s `resetTestDatabase()` (see its
`support/reset.ts`) only loads `db/seed/0001_synthetic_sample_data.sql` —
it does *not* load `db/seed/0002_nyc_pilot_department.sql`, so NYPD does not
exist in this test database at all, and this package's own
`packages/db-tests/src/support/seed-ids.ts` has no `departments.nyc` entry
(only `departments.springfield`/`departments.shelbyville`, each a bare UUID
*string*, not an `{id, name}` object — a different shape than
`apps/ingestion/test/support/seed-ids.ts`'s copy of the same constant,
which does include `nyc` since that suite's reset loads both seed files).
Use `SEED.departments.springfield` exactly as shown above — do not
reference `.nyc` or `.id` in this package's test files.

- [ ] **Step 4: Create the uniqueness-index test**

Create `packages/db-tests/src/tests/officer-external-ref-uniqueness.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";

// Migration 0020: officers.external_officer_ref is the stable cross-run
// identity key ingestion pipelines use to avoid creating duplicate officer
// rows for the same real officer (e.g. "nyc_ccrb:<tax_id>"). The partial
// unique index (WHERE external_officer_ref IS NOT NULL) must reject a
// second officer claiming the same ref, while allowing any number of
// officers with no ref at all (NULL, from manual creation or other
// sources with no stable id).
const UNIQUE_VIOLATION = "23505";

describe("officers.external_officer_ref uniqueness (migration 0020)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool(INTERNAL_API_URL);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("rejects a second officer with the same non-null external_officer_ref", async () => {
    await pool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
       VALUES ('First', 'Officer', $1, 'active', 'nyc_ccrb:12345')`,
      [SEED.departments.springfield],
    );

    await expect(
      pool.query(
        `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
         VALUES ('Second', 'Officer', $1, 'active', 'nyc_ccrb:12345')`,
        [SEED.departments.springfield],
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it("allows any number of officers with a NULL external_officer_ref", async () => {
    await pool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status)
       VALUES ('First', 'NoRef', $1, 'active')`,
      [SEED.departments.springfield],
    );
    const second = await pool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status)
       VALUES ('Second', 'NoRef', $1, 'active') RETURNING id`,
      [SEED.departments.springfield],
    );
    expect(second.rowCount).toBe(1);
  });
});
```

Same caveat as Step 3 above: `packages/db-tests`'s `SEED.departments` only
has `springfield`/`shelbyville`, each a bare UUID string — use
`SEED.departments.springfield` directly (no `.nyc`, no `.id` accessor).

- [ ] **Step 5: Run the affected test suite and lint**

```bash
npm run --workspace packages/db-tests test
npm run --workspace apps/ingestion lint
```

Expected: all `packages/db-tests` tests pass, including the two new ones
and the modified `role-grants.test.ts`. Lint has nothing to check yet for
this task (no `apps/ingestion` source changed) — run it anyway per this
plan's Global Constraints so every task's verification is uniform.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0020_officer_external_ref.sql packages/db-tests/src/tests/role-grants.test.ts packages/db-tests/src/tests/officer-external-ref-uniqueness.test.ts
git commit -m "Add officers.external_officer_ref for cross-run officer identity (migration 0020)

Generic, namespaced (e.g. nyc_ccrb:<tax_id>) nullable column + partial
unique index -- the stable key ingestion pipelines will use to recognize
an already-created officer across separate runs, instead of re-matching
by fuzzy name every time or never resolving at all. No new grant needed:
migration 0015's existing cop_internal_api grant on officers covers new
columns automatically, verified here against a real role connection."
```

---

### Task 2: Surface `taxId`/rank/active-status on `NycCcrbAllegation`; add `fetchAllNycCcrbOfficers`

**Files:**
- Modify: `apps/ingestion/src/nyc-ccrb/client.ts`
- Modify: `apps/ingestion/test/nyc-ccrb/client.test.ts`

**Interfaces:**
- Consumes: nothing new (same Socrata datasets already used).
- Produces: `NycCcrbAllegation.taxId: string | null`, `.officerRank: string | null`, `.officerActive: boolean | null` (Task 4 and Task 5 read these). New exported `NycCcrbOfficerRosterEntry` interface and `fetchAllNycCcrbOfficers(options?: { appToken?: string }): Promise<NycCcrbOfficerRosterEntry[]>` (Task 3 calls this).

- [ ] **Step 1: Add the new fields to `NycCcrbAllegation` and `RawOfficerRow`**

In `apps/ingestion/src/nyc-ccrb/client.ts`, in the `NycCcrbAllegation`
interface, add after `shieldNo: string | null;`:

```typescript
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
```

In `RawOfficerRow`, add two fields after `shield_no?: string;`:

```typescript
  current_rank?: string;
  active_per_last_reported_status?: string;
```

- [ ] **Step 2: Populate the new fields in `normalizeAllegation`**

In `normalizeAllegation`, replace:

```typescript
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

with:

```typescript
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
    incidentDate: incidentDateByComplaintId.get(raw.complaint_id) ?? null,
  };
}
```

(`taxId` comes straight from the Allegations row itself — `raw.tax_id` — not
from the `officer` join lookup, since it's the join *key*, available even
when the join finds nothing. `officerRank`/`officerActive` come from the
join, like `shieldNo` already does.)

- [ ] **Step 3: Add the full-roster fetch function**

Add a new constant near the existing `MAX_PAGES`/`BATCH_SIZE` constants
(after `const BATCH_SIZE = 200;`):

```typescript
/** Hard cap on pagination for fetchAllNycCcrbOfficers's full-dataset fetch
 * (unlike the tax_id-scoped join above, this fetches every row in
 * 2fir-qns4, not just ones referenced by recently-fetched allegations).
 * Live-verified total row count: 97,551 (2026-07-27, `$select=count(tax_id)`)
 * -- 150 pages * 1,000 = 150,000 gives comfortable headroom for roster
 * growth before this cap could ever bind. */
const OFFICERS_FULL_FETCH_MAX_PAGES = 150;
```

Add this new exported interface and function after `NycCcrbAllegation`'s
definition (do not modify `fetchNycCcrbAllegations` itself):

```typescript
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
```

Check the exact URL-building convention `fetchClosedComplaints` already
uses in this same file (it may build the URL slightly differently, e.g.
`${BASE_URL}/${dataset}.json` vs a helper function) — match whatever
pattern is already there rather than introducing a second convention.

- [ ] **Step 4: Fix the existing exact-equality test in `client.test.ts`**

In `apps/ingestion/test/nyc-ccrb/client.test.ts`, the first test's
`expect(allegations).toEqual([...])` block must include the three new
fields. Replace:

```typescript
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
```

with:

```typescript
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
        taxId: "942643",
        officerRank: null,
        officerActive: null,
        incidentDate: "2018-01-05",
      },
    ]);
```

(The mocked officer row in this test — `{ tax_id: "942643",
officer_first_name: "Alfred", officer_last_name: "Hernandez", shield_no:
"05046" }` — has no `current_rank`/`active_per_last_reported_status`
fields, so both new join-derived fields are `null`; `taxId` comes from the
Allegations row's own `tax_id: "942643"`, present in that same test's
Allegations mock.)

Every other existing test in this file that uses `toMatchObject` (not
`toEqual`) needs no change — `toMatchObject` doesn't fail on extra fields
it doesn't assert against.

- [ ] **Step 5: Add new tests for `officerRank`/`officerActive` mapping**

Add this test after the existing "sets incidentDate to null..." test:

```typescript
  it("maps officerRank and officerActive from the Officers-dataset join, and taxId straight from the Allegations row", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6", incident_date: "2020-01-01" }]);
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          {
            complaint_id: "6",
            complaint_officer_number: "1",
            allegation_record_identity: "240282",
            tax_id: "555555",
            fado_type: "Force",
            allegation: "x",
          },
        ]);
      }
      return jsonResponse([
        {
          tax_id: "555555",
          officer_first_name: "Pat",
          officer_last_name: "Rivera",
          shield_no: "1000",
          current_rank: "Sergeant",
          active_per_last_reported_status: "Yes",
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1);
    expect(allegations[0].taxId).toBe("555555");
    expect(allegations[0].officerRank).toBe("Sergeant");
    expect(allegations[0].officerActive).toBe(true);
  });

  it("maps officerActive to false when active_per_last_reported_status is present but not \"Yes\"", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6", incident_date: "2020-01-01" }]);
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          { complaint_id: "6", complaint_officer_number: "1", allegation_record_identity: "240282", tax_id: "555555", fado_type: "Force", allegation: "x" },
        ]);
      }
      return jsonResponse([
        { tax_id: "555555", officer_first_name: "Pat", officer_last_name: "Rivera", active_per_last_reported_status: "No" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();
    expect(allegations[0].officerActive).toBe(false);
  });

  it("sets taxId to null when the Allegations row itself has no tax_id", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6", incident_date: "2020-01-01" }]);
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
    expect(allegations[0].taxId).toBeNull();
    expect(allegations[0].officerRank).toBeNull();
    expect(allegations[0].officerActive).toBeNull();
  });
```

- [ ] **Step 6: Add a new `describe` block testing `fetchAllNycCcrbOfficers`**

Add at the end of `client.test.ts`, after the closing `});` of the
`describe("fetchNycCcrbAllegations", ...)` block:

```typescript
describe("fetchAllNycCcrbOfficers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and normalizes every row, mapping active_per_last_reported_status to a boolean", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        { tax_id: "1", officer_first_name: "Chris", officer_last_name: "Dengel", shield_no: "01717", current_rank: "Sergeant", active_per_last_reported_status: "No" },
        { tax_id: "2", officer_first_name: "Nabil", officer_last_name: "Laafar", shield_no: "15663", current_rank: "Police Officer", active_per_last_reported_status: "Yes" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const officers = await fetchAllNycCcrbOfficers();

    expect(officers).toEqual([
      { taxId: "1", firstName: "Chris", lastName: "Dengel", badgeNumber: "01717", rank: "Sergeant", active: false },
      { taxId: "2", firstName: "Nabil", lastName: "Laafar", badgeNumber: "15663", rank: "Police Officer", active: true },
    ]);
  });

  it("skips a row missing tax_id, officer_first_name, or officer_last_name rather than throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        { officer_first_name: "No", officer_last_name: "TaxId" },
        { tax_id: "3", officer_last_name: "NoFirstName" },
        { tax_id: "4", officer_first_name: "No" },
        { tax_id: "5", officer_first_name: "Has", officer_last_name: "All" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const officers = await fetchAllNycCcrbOfficers();
    expect(officers).toHaveLength(1);
    expect(officers[0].taxId).toBe("5");
  });

  it("follows $offset pagination until a page returns fewer than PAGE_SIZE rows", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      tax_id: String(i), officer_first_name: "F", officer_last_name: "L",
    }));
    const shortPage = [{ tax_id: "1000", officer_first_name: "F", officer_last_name: "L" }];

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      return jsonResponse(callCount === 1 ? fullPage : shortPage);
    });
    vi.stubGlobal("fetch", fetchMock);

    const officers = await fetchAllNycCcrbOfficers();

    expect(callCount).toBe(2);
    expect(officers).toHaveLength(1001);
  });

  it("sends the X-App-Token header when an app token is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAllNycCcrbOfficers({ appToken: "test-token" });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["X-App-Token"]).toBe("test-token");
  });
});
```

Add `fetchAllNycCcrbOfficers` to this file's existing import line:

```typescript
import { fetchNycCcrbAllegations, fetchAllNycCcrbOfficers } from "../../src/nyc-ccrb/client.js";
```

- [ ] **Step 7: Run tests and lint**

```bash
npm run --workspace apps/ingestion test
npm run --workspace apps/ingestion lint
```

Expected: all tests pass, including every existing test in this file
(none of their behavior changed, only the one `toEqual` block above needed
updating for the new fields) and all new tests. Lint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/client.ts apps/ingestion/test/nyc-ccrb/client.test.ts
git commit -m "Surface taxId/rank/active-status on NycCcrbAllegation; add fetchAllNycCcrbOfficers

NycCcrbAllegation previously swallowed tax_id after using it internally
to join officer name/shield -- it's needed as the stable cross-run
officer-identity key for the pipeline fix and bulk import in the next
two tasks. Also adds officerRank/officerActive (from fields the Officers
join already fetches but previously discarded), and a new
fetchAllNycCcrbOfficers export that paginates NYC CCRB's entire Officers
dataset (97,551 rows, live-verified count) rather than the existing
join's tax_id-scoped fetch -- backing the next task's one-time bulk
import."
```

---

### Task 3: One-time bulk-import script for NYC CCRB's officer roster

**Files:**
- Create: `apps/ingestion/src/nyc-ccrb/backfillOfficers.ts`
- Create: `apps/ingestion/test/nyc-ccrb/backfillOfficers.test.ts`
- Modify: `apps/ingestion/src/index.ts`
- Modify: `apps/ingestion/package.json`

**Interfaces:**
- Consumes: `fetchAllNycCcrbOfficers` and `NycCcrbOfficerRosterEntry` from `./client.js` (Task 2). Reuses `NycCcrbRunConfig` and `isNycCcrbConfig` from `./run.js` (this task exports `isNycCcrbConfig` from `run.ts`, currently unexported).
- Produces: `runNycCcrbOfficerBulkImport(pool, env, deps?)` — an operational entry point wired into `index.ts`, not consumed by any other task in this plan.

- [ ] **Step 1: Export `isNycCcrbConfig` from `run.ts`**

In `apps/ingestion/src/nyc-ccrb/run.ts`, change:

```typescript
function isNycCcrbConfig(value: unknown): value is NycCcrbRunConfig {
```

to:

```typescript
export function isNycCcrbConfig(value: unknown): value is NycCcrbRunConfig {
```

(No other change to this file in this task — Task 4 makes the rest of the
changes to `run.ts`.)

- [ ] **Step 2: Write the bulk-import script**

Create `apps/ingestion/src/nyc-ccrb/backfillOfficers.ts`:

```typescript
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
```

- [ ] **Step 3: Wire into `index.ts`**

In `apps/ingestion/src/index.ts`, add the import:

```typescript
import { runNycCcrbOfficerBulkImport } from "./nyc-ccrb/backfillOfficers.js";
```

Add a new branch in `main()`, right after the existing `if (pipeline ===
"nyc_ccrb") { ... }` block (before the final `throw new Error(...)`):

```typescript
  if (pipeline === "nyc_ccrb_backfill_officers") {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const results = await runNycCcrbOfficerBulkImport(pool, { socrataAppToken: process.env.SOCRATA_APP_TOKEN });
      for (const r of results) {
        console.log(`${r.departmentName}: fetched ${r.totalFetched}, imported ${r.totalImported} new officers.`);
      }
    } finally {
      await pool.end();
    }
    return;
  }
```

Update the final error's known-pipelines list:

```typescript
  throw new Error(`Unknown pipeline: "${pipeline}". Known pipelines: courtlistener, nyc_ccrb, nyc_ccrb_backfill_officers.`);
```

- [ ] **Step 4: Add the npm script**

In `apps/ingestion/package.json`, add after the existing `"ingest:nyc-ccrb:built"` line:

```json
    "backfill:nyc-ccrb-officers": "tsx src/index.ts nyc_ccrb_backfill_officers",
    "backfill:nyc-ccrb-officers:built": "node dist/src/index.js nyc_ccrb_backfill_officers",
```

(Match the existing file's exact comma placement — this is not the last
key in the `scripts` block, so it needs a trailing comma same as its
neighbors.)

- [ ] **Step 5: Write the test file**

Create `apps/ingestion/test/nyc-ccrb/backfillOfficers.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { runNycCcrbOfficerBulkImport } from "../../src/nyc-ccrb/backfillOfficers.js";
import type { NycCcrbOfficerRosterEntry } from "../../src/nyc-ccrb/client.js";

const ENV = {};

function officer(overrides: Partial<NycCcrbOfficerRosterEntry> = {}): NycCcrbOfficerRosterEntry {
  return {
    taxId: "111111",
    firstName: "Pat",
    lastName: "Rivera",
    badgeNumber: "1000",
    rank: "Sergeant",
    active: true,
    ...overrides,
  };
}

async function insertConfig(pool: Pool, config: { departmentName: string }): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', true, $1) RETURNING id`,
    [JSON.stringify(config)],
  );
  return result.rows[0].id;
}

describe("runNycCcrbOfficerBulkImport", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("imports officers with correct field mapping, including employment_status derived from active", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([
      officer({ taxId: "1", active: true }),
      officer({ taxId: "2", firstName: "Chris", lastName: "Dengel", active: false }),
    ]);

    const results = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });

    expect(results).toEqual([
      { configId: SEED.departments.nyc.name, departmentName: SEED.departments.nyc.name, totalFetched: 2, totalImported: 2 },
    ]);

    const rows = await pool.query(
      `SELECT first_name, last_name, badge_number, rank, employment_status, external_officer_ref, department_id
         FROM officers ORDER BY external_officer_ref`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      first_name: "Pat",
      last_name: "Rivera",
      badge_number: "1000",
      rank: "Sergeant",
      employment_status: "active",
      external_officer_ref: "nyc_ccrb:1",
      department_id: SEED.departments.nyc.id,
    });
    expect(rows.rows[1]).toMatchObject({
      first_name: "Chris",
      last_name: "Dengel",
      employment_status: "inactive",
      external_officer_ref: "nyc_ccrb:2",
    });
  });

  it("writes a record_revisions row for each newly-created officer, changed_by NULL", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([officer({ taxId: "1" })]);

    await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });

    const officerRow = await pool.query(`SELECT id FROM officers WHERE external_officer_ref = 'nyc_ccrb:1'`);
    const revisions = await pool.query(
      `SELECT change_type, changed_by, diff FROM record_revisions WHERE record_type = 'officer' AND record_id = $1`,
      [officerRow.rows[0].id],
    );
    expect(revisions.rows).toHaveLength(1);
    expect(revisions.rows[0].change_type).toBe("create");
    expect(revisions.rows[0].changed_by).toBeNull();
    expect(revisions.rows[0].diff).toMatchObject({ source: "nyc_ccrb_officer_bulk_import", externalOfficerRef: "nyc_ccrb:1" });
  });

  it("is idempotent -- re-running does not create duplicate officers", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([officer({ taxId: "1" })]);

    const first = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });
    expect(first[0].totalImported).toBe(1);

    const second = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });
    expect(second[0].totalImported).toBe(0); // already present, skipped via ON CONFLICT DO NOTHING

    const count = await pool.query(`SELECT count(*) FROM officers WHERE external_officer_ref = 'nyc_ccrb:1'`);
    expect(count.rows[0].count).toBe("1");
  });

  it("batches across multiple chunks correctly", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const officers = Array.from({ length: 7 }, (_, i) => officer({ taxId: String(i) }));
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue(officers);

    const results = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers }, 3);

    expect(results[0].totalImported).toBe(7);
    const count = await pool.query(`SELECT count(*) FROM officers WHERE external_officer_ref LIKE 'nyc_ccrb:%'`);
    expect(count.rows[0].count).toBe("7");
  });

  it("skips a config row whose config JSON doesn't match the expected shape", async () => {
    await pool.query(`INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', true, $1)`, [
      JSON.stringify({ notTheRightShape: true }),
    ]);
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([]);

    const results = await runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers });
    expect(results).toEqual([]);
    expect(fetchAllNycCcrbOfficers).not.toHaveBeenCalled();
  });

  it("throws a clear error when the config's departmentName doesn't resolve to a real department", async () => {
    await insertConfig(pool, { departmentName: "Nonexistent Department" });
    const fetchAllNycCcrbOfficers = vi.fn().mockResolvedValue([]);

    await expect(runNycCcrbOfficerBulkImport(pool, ENV, { fetchAllNycCcrbOfficers })).rejects.toThrow(/No department found/);
  });
});
```

- [ ] **Step 6: Run tests and lint**

```bash
npm run --workspace apps/ingestion test
npm run --workspace apps/ingestion lint
```

Expected: all tests pass, lint clean.

- [ ] **Step 7: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/backfillOfficers.ts apps/ingestion/test/nyc-ccrb/backfillOfficers.test.ts apps/ingestion/src/nyc-ccrb/run.ts apps/ingestion/src/index.ts apps/ingestion/package.json
git commit -m "Add one-time NYC CCRB officer roster bulk-import script

Bulk-imports NYC CCRB's entire 97,551-row Officers reference dataset as
a department's initial roster, using batched unnest()-based multi-row
inserts (not the one-row-per-transaction pattern the weekly pipeline
uses, which does not scale to this volume -- see design doc §2).
Idempotent via ON CONFLICT DO NOTHING against external_officer_ref, so
re-running after CCRB adds new officers only imports what's new. Wired
into index.ts as 'nyc_ccrb_backfill_officers', run manually, not on the
weekly schedule."
```

---

### Task 4: Weekly pipeline resolves officers by `external_officer_ref` first

**Files:**
- Modify: `apps/ingestion/src/nyc-ccrb/run.ts`
- Modify: `apps/ingestion/test/nyc-ccrb/run.test.ts`

**Interfaces:**
- Consumes: `NycCcrbAllegation.taxId`/`.officerRank`/`.officerActive` (Task 2). `officers.external_officer_ref` (Task 1).
- Produces: nothing new other tasks in this plan depend on — this is where the actual weekly-pipeline behavior changes.

- [ ] **Step 1: Add the department-id lookup and officer-resolution helper**

In `apps/ingestion/src/nyc-ccrb/run.ts`, add `MatchResult` to the existing
type-only import line:

```typescript
import type { CandidateItem, MatchResult } from "@cop/ingestion-lib";
```

Add this new function after `isNycCcrbConfig` (now exported, per Task 3)
and before `runOneConfigRow`:

```typescript
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
```

`run.ts`'s existing import from `./client.js` is value-only
(`import { fetchNycCcrbAllegations } from "./client.js";`) — it does not
import the `NycCcrbAllegation` type, which `resolveOrCreateOfficer`'s
signature above now needs. Change that line to:

```typescript
import { fetchNycCcrbAllegations, type NycCcrbAllegation } from "./client.js";
```

- [ ] **Step 2: Look up `departmentId` once per config row, and call the new resolver**

In `runOneConfigRow`, right after `const runId = await startRun(pool,
"nyc_ccrb");` and before the `try {` block's existing content, the
department lookup must happen *inside* the `try` block (so a missing
department is caught and recorded on this row's `ingestion_runs` entry,
the same error-isolation guarantee this file already gives every other
per-row failure — not a crash that aborts other config rows' runs).

Replace:

```typescript
  try {
    const allegations = await deps.fetchNycCcrbAllegations({ appToken: env.socrataAppToken });
    itemsFetched = allegations.length;
```

with:

```typescript
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
```

Then replace the existing match call:

```typescript
      const matchResult = await matchOfficer(pool, {
        name: officerName,
        departmentName: config.departmentName,
      });
```

with:

```typescript
      const matchResult = await resolveOrCreateOfficer(pool, allegation, config, departmentId);
```

The `officerName` local variable computed just above this call
(`const officerName = allegation.officerFirstName && ... ;`) becomes
unused at this call site once `resolveOrCreateOfficer` computes its own
copy internally — check whether `officerName` is still used lower down in
this same loop body (it's read by the existing `noteParts`-building `if
(!officerName)` check a few lines later). If it's still used there, leave
the local variable exactly as-is; only the `matchOfficer` call itself is
being replaced.

- [ ] **Step 3: Update the shared test fixture**

In `apps/ingestion/test/nyc-ccrb/run.test.ts`, update the `allegation()`
helper to include the three new required `NycCcrbAllegation` fields:

```typescript
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
    taxId: "942643",
    officerRank: "Police Officer",
    officerActive: true,
    incidentDate: "2018-01-05",
    ...overrides,
  };
}
```

- [ ] **Step 4: Rewrite the one existing test whose assertions are now stale**

The test `"queues a low-confidence candidate with a note when no shield
number is on file"` asserted `match_confidence: "low"` for a scenario
where, under the *old* behavior, no officer could ever be resolved because
none existed. That's exactly the gap this plan closes — with `taxId` and a
full name present and no existing officer to match, `resolveOrCreateOfficer`
now creates one. Replace the entire test:

```typescript
  it("queues a low-confidence candidate with a note when no shield number is on file", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ shieldNo: null })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].proposed_record.note).toMatch(/no shield number/i);
  });
```

with:

```typescript
  it("creates a new officer (badge_number NULL) and still includes the no-shield-number note, when no shield number is on file", async () => {
    // Before this feature, no officers row existed for NYC to match
    // against at all, so this landed at 'low' confidence with
    // officerId: null. Now, with taxId + a full name present and no
    // existing officer, resolveOrCreateOfficer creates one -- the note is
    // still worth keeping (a reviewer should still double-check identity
    // on a freshly-created officer with no badge number on file), it's
    // just no longer paired with an unresolved match.
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ shieldNo: null })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1);
    expect(reviewQueueRows.rows[0].match_confidence).toBe("high");
    expect(reviewQueueRows.rows[0].proposed_record.note).toMatch(/no shield number/i);
    expect(reviewQueueRows.rows[0].proposed_record.officerId).toBeDefined();

    const officerRow = await pool.query(
      `SELECT badge_number, external_officer_ref, rank, employment_status FROM officers WHERE external_officer_ref = 'nyc_ccrb:942643'`,
    );
    expect(officerRow.rows).toHaveLength(1);
    expect(officerRow.rows[0].badge_number).toBeNull();
    expect(officerRow.rows[0].rank).toBe("Police Officer");
    expect(officerRow.rows[0].employment_status).toBe("active");
  });
```

- [ ] **Step 5: Add new tests for the resolution-order behavior**

Add these tests after the rewritten test from Step 4:

```typescript
  it("resolves via external_officer_ref immediately when a prior officer already has it set, skipping fuzzy matching", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const priorOfficer = await pool.query<{ id: string }>(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
       VALUES ('Someone', 'Different', $1, 'active', 'nyc_ccrb:942643') RETURNING id`,
      [SEED.departments.nyc.id],
    );

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);
    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record, rq.match_confidence
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows[0].match_confidence).toBe("high");
    expect(reviewQueueRows.rows[0].proposed_record.officerId).toBe(priorOfficer.rows[0].id);

    const officerCount = await pool.query(`SELECT count(*) FROM officers`);
    expect(officerCount.rows[0].count).toBe("1"); // no new officer created
  });

  it("does not stamp external_officer_ref onto an officer resolved only via matchOfficer's fuzzy name+department match", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    // Same officer as the "clean candidate" test above, but with no
    // external_officer_ref set -- exercises the fuzzy-match fallback path.
    const fuzzyMatched = await pool.query<{ id: string }>(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status)
       VALUES ('Alfred', 'Hernandez', $1, 'active') RETURNING id`,
      [SEED.departments.nyc.id],
    );

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);
    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.match_confidence, rq.proposed_record
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows[0].match_confidence).toBe("medium");
    expect(reviewQueueRows.rows[0].proposed_record.officerId).toBe(fuzzyMatched.rows[0].id);

    const officerRow = await pool.query(`SELECT external_officer_ref FROM officers WHERE id = $1`, [
      fuzzyMatched.rows[0].id,
    ]);
    expect(officerRow.rows[0].external_officer_ref).toBeNull(); // not stamped
  });

  it("reuses the same newly-created officer across two allegations sharing the same taxId within one run", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([
      allegation({ allegationRecordIdentity: "240282" }),
      allegation({ allegationRecordIdentity: "240281" }),
    ]);
    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const officerCount = await pool.query(`SELECT count(*) FROM officers WHERE external_officer_ref = 'nyc_ccrb:942643'`);
    expect(officerCount.rows[0].count).toBe("1");

    const reviewQueueRows = await pool.query(
      `SELECT DISTINCT rq.proposed_record->>'officerId' AS officer_id
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref IN ('201806447:240282', '201806447:240281')`,
    );
    expect(reviewQueueRows.rows).toHaveLength(1); // both point at the same officerId
  });

  it("leaves the candidate unresolved (low confidence, no officer created) when there's no officer name at all, even with a taxId present", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi
      .fn()
      .mockResolvedValue([allegation({ officerFirstName: null, officerLastName: null })]);
    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.match_confidence, rq.proposed_record
         FROM review_queue rq JOIN sources s ON s.id = rq.source_id
        WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows[0].match_confidence).toBe("low");
    expect(reviewQueueRows.rows[0].proposed_record.officerId).toBeUndefined();

    const officerCount = await pool.query(`SELECT count(*) FROM officers`);
    expect(officerCount.rows[0].count).toBe("0");
  });
```

Check `SEED.departments.nyc.id` is the correct accessor against the actual
`apps/ingestion/test/support/seed-ids.ts` (confirmed present with this
exact shape as of this plan being written — re-check only if it errors).

- [ ] **Step 6: Fix a real break in the existing "isolates one config row's
  failure" test caused by Step 2's new department lookup**

That test's first (intentionally-failing) config row uses
`departmentName: "Some Other Department"` — a name that doesn't match any
seeded department. Before this task's change, that was harmless (`matchOfficer`
just used the name as a fuzzy-match filter string that happened to match
nothing). After Step 2's change, the *new* department lookup at the top of
the `try` block now runs before `fetchNycCcrbAllegations` is even called,
so this row would throw "No department found..." instead of reaching the
mocked fetch throw the test is actually testing — breaking
`expect(fetchNycCcrbAllegations).toHaveBeenCalledTimes(2)` and the
`/500 Internal Server Error/` assertion.

Fix by pointing that row at a real seeded department instead — the test's
actual intent (one row's mocked-fetch failure doesn't stop other rows from
running) is unaffected by which real department name is used. Replace:

```typescript
    const failingConfigId = await insertConfig(pool, { departmentName: "Some Other Department" });
```

with:

```typescript
    const failingConfigId = await insertConfig(pool, { departmentName: SEED.departments.springfield.name });
```

- [ ] **Step 7: Run tests and lint**

```bash
npm run --workspace apps/ingestion test
npm run --workspace apps/ingestion lint
```

Expected: all tests pass (every pre-existing test either unaffected or
deliberately rewritten above), lint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/run.ts apps/ingestion/test/nyc-ccrb/run.test.ts
git commit -m "Weekly NYC CCRB pipeline resolves officers by external_officer_ref first

Replaces the always-fuzzy-match-only matchOfficer call with a three-step
resolveOrCreateOfficer: exact external_officer_ref hit (authoritative,
'high'), falling back to the existing matchOfficer fuzzy path unchanged,
falling back (rarely, once backfillOfficers.ts's bulk import has run) to
creating a new officer from the allegation's own CCRB roster fields.
Deliberately never stamps external_officer_ref onto a fuzzy-matched
officer -- only an exact tax-id hit or a fresh creation may set it, so a
wrong fuzzy guess can never become a permanent auto-resolved identity
link in a future run."
```

---

### Task 5: Backfill the 2,231 already-queued `review_queue` items

**Files:**
- Create: `apps/ingestion/src/nyc-ccrb/backfillReviewQueue.ts`
- Create: `apps/ingestion/test/nyc-ccrb/backfillReviewQueue.test.ts`
- Modify: `apps/ingestion/src/index.ts`
- Modify: `apps/ingestion/package.json`

**Interfaces:**
- Consumes: `fetchNycCcrbAllegations` (now taxId-surfacing, Task 2), `officers.external_officer_ref` (Task 1, populated by Task 3's bulk import).
- Produces: nothing other tasks depend on — the last task in this plan.

- [ ] **Step 1: Write the backfill script**

Create `apps/ingestion/src/nyc-ccrb/backfillReviewQueue.ts`:

```typescript
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
```

- [ ] **Step 2: Wire into `index.ts`**

Add the import:

```typescript
import { runNycCcrbReviewQueueBackfill } from "./nyc-ccrb/backfillReviewQueue.js";
```

Add a new branch after the `nyc_ccrb_backfill_officers` block from Task 3,
before the final `throw`:

```typescript
  if (pipeline === "nyc_ccrb_backfill_review_queue") {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const results = await runNycCcrbReviewQueueBackfill(pool, { socrataAppToken: process.env.SOCRATA_APP_TOKEN });
      for (const r of results) {
        console.log(`${r.departmentName}: checked ${r.allegationsChecked} allegations, updated ${r.reviewQueueRowsUpdated} review_queue rows.`);
      }
    } finally {
      await pool.end();
    }
    return;
  }
```

Update the known-pipelines error message:

```typescript
  throw new Error(
    `Unknown pipeline: "${pipeline}". Known pipelines: courtlistener, nyc_ccrb, nyc_ccrb_backfill_officers, nyc_ccrb_backfill_review_queue.`,
  );
```

- [ ] **Step 3: Add the npm script**

In `apps/ingestion/package.json`, add after the `backfill:nyc-ccrb-officers:built` line from Task 3:

```json
    "backfill:nyc-ccrb-review-queue": "tsx src/index.ts nyc_ccrb_backfill_review_queue",
    "backfill:nyc-ccrb-review-queue:built": "node dist/src/index.js nyc_ccrb_backfill_review_queue",
```

- [ ] **Step 4: Write the test file**

Create `apps/ingestion/test/nyc-ccrb/backfillReviewQueue.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, INTERNAL_API_URL } from "../support/connections.js";
import { resetTestDatabase } from "../support/reset.js";
import { SEED } from "../support/seed-ids.js";
import { runNycCcrbReviewQueueBackfill } from "../../src/nyc-ccrb/backfillReviewQueue.js";
import type { NycCcrbAllegation } from "../../src/nyc-ccrb/client.js";

const ENV = {};

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
    taxId: "942643",
    officerRank: "Police Officer",
    officerActive: true,
    incidentDate: "2018-01-05",
    ...overrides,
  };
}

async function insertConfig(pool: Pool, config: { departmentName: string }): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_configs (source_type, enabled, config) VALUES ('nyc_ccrb', true, $1) RETURNING id`,
    [JSON.stringify(config)],
  );
  return result.rows[0].id;
}

async function insertPendingQueueItem(
  pool: Pool,
  externalRef: string,
  proposedRecord: Record<string, unknown>,
): Promise<string> {
  const source = await pool.query<{ id: string }>(
    `INSERT INTO sources (source_type, reliability_tier, external_ref) VALUES ('official_dataset', 'tier2_official_dataset', $1) RETURNING id`,
    [externalRef],
  );
  const queueItem = await pool.query<{ id: string }>(
    `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status) VALUES ($1, $2, 'low', 'pending') RETURNING id`,
    [JSON.stringify(proposedRecord), source.rows[0].id],
  );
  return queueItem.rows[0].id;
}

describe("runNycCcrbReviewQueueBackfill", () => {
  let pool: Pool;

  beforeEach(async () => {
    await resetTestDatabase();
    pool = createPool(INTERNAL_API_URL);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("resolves a pending item's officerId when the officer already exists via external_officer_ref, stripping officerName", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const officerRow = await pool.query<{ id: string }>(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
       VALUES ('Alfred', 'Hernandez', $1, 'active', 'nyc_ccrb:942643') RETURNING id`,
      [SEED.departments.nyc.id],
    );
    const queueItemId = await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerName: "Alfred Hernandez",
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "CCRB complaint: Force - Physical force.",
    });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results).toEqual([
      { departmentName: SEED.departments.nyc.name, allegationsChecked: 1, reviewQueueRowsUpdated: 1 },
    ]);

    const updated = await pool.query(`SELECT proposed_record, match_confidence FROM review_queue WHERE id = $1`, [
      queueItemId,
    ]);
    expect(updated.rows[0].match_confidence).toBe("high");
    expect(updated.rows[0].proposed_record.officerId).toBe(officerRow.rows[0].id);
    expect(updated.rows[0].proposed_record.officerName).toBeUndefined();
  });

  it("leaves a pending item untouched when no officer resolves for it yet", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const queueItemId = await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerName: "Alfred Hernandez",
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "CCRB complaint: Force - Physical force.",
    });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]); // no officer row exists to match
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(0);
    const untouched = await pool.query(`SELECT proposed_record, match_confidence FROM review_queue WHERE id = $1`, [
      queueItemId,
    ]);
    expect(untouched.rows[0].match_confidence).toBe("low");
    expect(untouched.rows[0].proposed_record.officerName).toBe("Alfred Hernandez");
  });

  it("does not touch a review_queue row that's already been approved or rejected, even if an officer now resolves for it", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    await pool.query(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
       VALUES ('Alfred', 'Hernandez', $1, 'active', 'nyc_ccrb:942643')`,
      [SEED.departments.nyc.id],
    );
    const source = await pool.query<{ id: string }>(
      `INSERT INTO sources (source_type, reliability_tier, external_ref) VALUES ('official_dataset', 'tier2_official_dataset', '201806447:240280') RETURNING id`,
    );
    const rejected = await pool.query<{ id: string }>(
      `INSERT INTO review_queue (proposed_record, source_id, match_confidence, status) VALUES ($1, $2, 'low', 'rejected') RETURNING id`,
      [JSON.stringify({ type: "incident_candidate", officerName: "Alfred Hernandez", departmentName: SEED.departments.nyc.name, incidentType: "use_of_force", shortDescription: "x" }), source.rows[0].id],
    );

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation()]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(0);
    const stillRejected = await pool.query(`SELECT status, proposed_record FROM review_queue WHERE id = $1`, [
      rejected.rows[0].id,
    ]);
    expect(stillRejected.rows[0].status).toBe("rejected");
    expect(stillRejected.rows[0].proposed_record.officerName).toBe("Alfred Hernandez"); // untouched
  });

  it("skips an allegation with no taxId", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerName: "Alfred Hernandez",
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "x",
    });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ taxId: null })]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(0);
  });
});
```

- [ ] **Step 5: Run tests and lint**

```bash
npm run --workspace apps/ingestion test
npm run --workspace apps/ingestion lint
```

Expected: all tests pass, lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/backfillReviewQueue.ts apps/ingestion/test/nyc-ccrb/backfillReviewQueue.test.ts apps/ingestion/src/index.ts apps/ingestion/package.json
git commit -m "Add one-time backfill for the 2,231 already-queued NYC CCRB review items

Re-fetches the same allegations (now taxId-surfacing) and resolves each
still-pending review_queue row's officerId via external_officer_ref,
stripping officerName per IncidentCandidateProposal's documented
never-both invariant. Only touches 'pending' rows -- anything already
approved/rejected by hand is left untouched. Must run after
backfillOfficers.ts's bulk import, not before, or every lookup here
misses."
```

---

## Post-implementation (not a task — operational follow-up, not code)

Once this plan's PR merges and the same migration + code ship to the
deployed Render instance (via the existing `deploy-migrate.yml` workflow
and a normal deploy), run against the real deployed database, in order:

```bash
DATABASE_URL="<deployed INGESTION_DATABASE_URL>" npm run --workspace apps/ingestion backfill:nyc-ccrb-officers:built
DATABASE_URL="<deployed INGESTION_DATABASE_URL>" npm run --workspace apps/ingestion backfill:nyc-ccrb-review-queue:built
```

This is a manual operational step (like the original NYC CCRB pipeline's
first real trigger earlier in this project), not something to automate
into a GitHub Actions workflow — it only ever needs to run once (or
rarely, to pick up new officers CCRB has added since the last run).
