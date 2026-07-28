# NYC CCRB Structured Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn NYC CCRB's already-fetched-but-discarded `nypd_disposition` field into real, structured `outcomes` rows, created automatically alongside an incident when a reviewer approves it — closing the gap where no pipeline or the review-queue approval flow has ever populated `outcomes` at all, despite the schema (migration 0008) and `record_revisions` (migration 0011) already anticipating it.

**Architecture:** A new, deliberately conservative mapping module (`apps/ingestion/src/nyc-ccrb/disposition.ts`) classifies a small, unambiguous subset of NYC CCRB's ~60 real disposition strings into the existing `OutcomeType` enum. A new generic `proposedOutcome` field rides on the existing `IncidentCandidateProposal`/`CandidateItem` types (pipeline-agnostic — any future source could use it the same way), gets populated by the NYC CCRB pipeline, displayed to the reviewer in the admin app, and turned into a real `outcomes` row (mirroring the existing manual `POST /api/internal/outcomes` route's insert/revision shape) atomically with the incident at approval time. The existing `backfillReviewQueue.ts` script (from the prior officer-bulk-import feature) is extended, not duplicated, to also backfill `proposedOutcome` onto the current 2,231-item backlog.

**Tech Stack:** No new dependencies — pure TypeScript/SQL additions to existing files and packages.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-27-nyc-ccrb-outcomes-design.md`.
- The disposition → outcome_type mapping is the exact, human-approved set from the design doc §2 — do not add, remove, or reclassify any string beyond what's listed there. If a task's implementer notices a disposition string that seems like it obviously belongs in a bucket but isn't listed, that is a finding to report, not something to silently add.
- `nypd_disposition` drives the mapping, never `ccrb_disposition` — the latter keeps its existing role as descriptive text only.
- No reviewer edit/skip control for the proposed outcome in this plan — it's shown (never silently created) and created automatically alongside the incident when approved, or not at all.
- `record_revisions` gets a real row for every created `outcomes` row, `changed_by` set to the approving reviewer's id (a human is approving this — unlike the prior officer-bulk-import feature's pipeline-authored `changed_by: NULL` convention, which does not apply here).
- Officer resolution and outcome resolution in the backfill script (Task 7) are independent — never let one gate the other.
- Every task's verification must include a type-check step for every package it touches (`npm run --workspace <pkg> build` for packages with no dedicated lint script — `packages/shared-types`, `packages/ingestion-lib`, `apps/api-internal` — or `npm run --workspace <pkg> lint` for `apps/ingestion`/`apps/admin`, which do have one), not just `test`.
- Task order is sequential: Tasks 1 and 2 are independent of each other but both must land before Task 4; Task 3 must land before Tasks 4, 5, and 6; Task 7 depends on Tasks 1 and 2.

---

### Task 1: Surface `closeDate` on `NycCcrbAllegation`

**Files:**
- Modify: `apps/ingestion/src/nyc-ccrb/client.ts`
- Modify: `apps/ingestion/test/nyc-ccrb/client.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NycCcrbAllegation.closeDate: string | null` — Task 4 reads this for the outcome's `date` field.

- [ ] **Step 1: Add `close_date` to the raw type and the Socrata `$select`**

In `apps/ingestion/src/nyc-ccrb/client.ts`, in `RawComplaintRow`, add:

```typescript
interface RawComplaintRow {
  complaint_id?: string;
  incident_date?: string;
  close_date?: string;
}
```

In `fetchClosedComplaints`, find:

```typescript
    params.set("$select", "complaint_id,incident_date");
```

Replace with:

```typescript
    params.set("$select", "complaint_id,incident_date,close_date");
```

(Socrata only returns fields named in `$select` — a field can exist on the dataset and still come back `undefined` if it isn't listed there.)

- [ ] **Step 2: Change `fetchClosedComplaints`'s return shape to carry both dates**

Find:

```typescript
async function fetchClosedComplaints(sinceDays: number, appToken?: string): Promise<Map<string, string | null>> {
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const incidentDateByComplaintId = new Map<string, string | null>();

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
        incidentDateByComplaintId.set(row.complaint_id, row.incident_date ?? null);
      }
    }
    if (rows.length < PAGE_SIZE) {
      break;
    }
  }
  return incidentDateByComplaintId;
}
```

Replace with:

```typescript
interface ComplaintDates {
  incidentDate: string | null;
  closeDate: string | null;
}

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
```

- [ ] **Step 3: Update every caller of `fetchClosedComplaints` for the new return shape**

In `fetchNycCcrbAllegations`, find:

```typescript
  const incidentDateByComplaintId = await fetchClosedComplaints(sinceDays, options.appToken);
  const complaintIds = [...incidentDateByComplaintId.keys()];
```

Replace with:

```typescript
  const datesByComplaintId = await fetchClosedComplaints(sinceDays, options.appToken);
  const complaintIds = [...datesByComplaintId.keys()];
```

A few lines later, find:

```typescript
    const normalized = normalizeAllegation(raw, officersByTaxId, incidentDateByComplaintId);
```

Replace with:

```typescript
    const normalized = normalizeAllegation(raw, officersByTaxId, datesByComplaintId);
```

- [ ] **Step 4: Add `closeDate` to `NycCcrbAllegation` and populate it in `normalizeAllegation`**

In `NycCcrbAllegation`, add after the existing `incidentDate` field:

```typescript
  /** CCRB's own close_date for the complaint this allegation belongs to
   * (when the case was closed, not when the alleged incident occurred) --
   * truncated to YYYY-MM-DD. Every complaint this pipeline ever fetches is
   * already filtered to be closed (fetchClosedComplaints's whole purpose),
   * so this is expected to be present in practice; null only if the raw
   * field was genuinely absent. Used as the outcome's date (never
   * incidentDate -- that would conflate two different dates). */
  closeDate: string | null;
```

In `normalizeAllegation`'s signature, find:

```typescript
function normalizeAllegation(
  raw: RawAllegationRow,
  officersByTaxId: Map<string, RawOfficerRow>,
  incidentDateByComplaintId: Map<string, string | null>,
): NycCcrbAllegation | null {
```

Replace with:

```typescript
function normalizeAllegation(
  raw: RawAllegationRow,
  officersByTaxId: Map<string, RawOfficerRow>,
  datesByComplaintId: Map<string, ComplaintDates>,
): NycCcrbAllegation | null {
```

Inside the function body, find:

```typescript
    incidentDate: incidentDateByComplaintId.get(raw.complaint_id) ?? null,
  };
}
```

Replace with:

```typescript
    incidentDate: datesByComplaintId.get(raw.complaint_id)?.incidentDate ?? null,
    closeDate: datesByComplaintId.get(raw.complaint_id)?.closeDate ?? null,
  };
}
```

- [ ] **Step 5: Update the existing tests in `client.test.ts`**

The first test's exact-equality assertion needs `closeDate` added, and its Complaints mock needs a `close_date` field so the value isn't just `null` by accident. Find (in the `"fetches closed complaints, joins matching allegations..."` test):

```typescript
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "201806447", incident_date: "2018-01-05" }]);
      }
```

Replace with:

```typescript
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "201806447", incident_date: "2018-01-05", close_date: "2018-06-01T12:00:00.000" }]);
      }
```

And in that same test's `expect(allegations).toEqual([...])` block, find:

```typescript
        taxId: "942643",
        officerRank: null,
        officerActive: null,
        incidentDate: "2018-01-05",
      },
    ]);
```

Replace with:

```typescript
        taxId: "942643",
        officerRank: null,
        officerActive: null,
        incidentDate: "2018-01-05",
        closeDate: "2018-06-01",
      },
    ]);
```

Also check the `complaintsUrl.searchParams.get("$where")` assertion a few lines later in the same test is unaffected (it isn't — `$where` didn't change, only `$select` did) — no change needed there.

Every other existing test in this file that provides a Complaints mock without `close_date` (e.g. `{ complaint_id: "1", incident_date: "2020-01-01" }` in several other tests) will now produce `closeDate: null` for those rows — since none of those tests assert on `closeDate` via `toEqual` (they use `toHaveLength`/`toMatchObject`/field-specific assertions), they remain valid unchanged. Confirm this by reading each remaining test in the file rather than assuming — if any other test in this file uses `toEqual` against a full allegation object, it needs the same `closeDate` addition as above.

- [ ] **Step 6: Add new tests for `closeDate` mapping**

Add after the existing `"sets incidentDate to null when the matching complaint has no incident_date"` test:

```typescript
  it("sets closeDate from the Complaints row's close_date, truncated to YYYY-MM-DD", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6", incident_date: "2020-01-01", close_date: "2021-03-15T09:30:00.000" }]);
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
    expect(allegations[0].closeDate).toBe("2021-03-15");
  });

  it("sets closeDate to null when the matching complaint has no close_date", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6", incident_date: "2020-01-01" }]); // no close_date field
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
    expect(allegations[0].closeDate).toBeNull();
  });

  it("requests close_date in the Complaints $select clause", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchNycCcrbAllegations();
    const complaintsUrl = urlFor(fetchMock, "2mby-ccnw");
    expect(complaintsUrl.searchParams.get("$select")).toBe("complaint_id,incident_date,close_date");
  });
```

- [ ] **Step 7: Run tests and lint**

```bash
npm run --workspace apps/ingestion test
npm run --workspace apps/ingestion lint
```

Expected: all tests pass (including every pre-existing test in this file, which need no behavior change beyond the one `toEqual` block updated in Step 5), lint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/client.ts apps/ingestion/test/nyc-ccrb/client.test.ts
git commit -m "Surface closeDate on NycCcrbAllegation from the Complaints join

close_date (when CCRB closed the case) is the right date for a
disciplinary outcome -- distinct from incidentDate (when the alleged
incident occurred), which the incident record already uses. Previously
only used internally as fetchClosedComplaints's windowing filter, never
stored per-row or surfaced past that function. Needed by the next task's
disposition-mapping work to give a created outcome a real date."
```

---

### Task 2: NYC CCRB disposition → outcome_type mapping module

**Files:**
- Create: `apps/ingestion/src/nyc-ccrb/disposition.ts`
- Create: `apps/ingestion/test/nyc-ccrb/disposition.test.ts`

**Interfaces:**
- Consumes: `OutcomeType` from `@cop/shared-types` (already exists — no change needed there for this task).
- Produces: `mapNypdDispositionToOutcomeType(disposition: string | null): OutcomeType | null` — Task 4 and Task 7 both call this.

- [ ] **Step 1: Write the mapping module**

Create `apps/ingestion/src/nyc-ccrb/disposition.ts`:

```typescript
import type { OutcomeType } from "@cop/shared-types";

/**
 * Conservative, human-reviewed mapping from NYC CCRB's real
 * nypd_allegation_disposition strings to this schema's OutcomeType --
 * see docs/superpowers/specs/2026-07-27-nyc-ccrb-outcomes-design.md §2
 * for the full rationale and the live Socrata query this was verified
 * against (60 distinct real values as of 2026-07-27).
 *
 * Deliberately NOT an exhaustive mapping of all 60 values -- only a
 * disposition string that unambiguously implies one of the three
 * dispositions actually reachable from NYPD disciplinary data
 * (internal_discipline, termination, no_action; the other four
 * OutcomeType values -- DA_declination, lawsuit_settlement,
 * lawsuit_dismissed, criminal_charges_officer -- belong to a civil-suit/
 * prosecution track this data source doesn't cover at all) gets mapped.
 * Everything else (bare "Guilty"/plea/negotiated dispositions that don't
 * state the resulting sanction, and pending/in-process/retired/resigned/
 * deceased/no-finding/other statuses) returns null -- the raw disposition
 * string still appears in the incident's own data regardless; it's just
 * not double-encoded as structured data when confidence is low.
 */

const TERMINATION_DISPOSITIONS = new Set(["APU Closed: Terminated"]);

const INTERNAL_DISCIPLINE_DISPOSITIONS = new Set([
  "Command Discipline - A",
  "Command Discipline - B",
  "APU Command Discipline A",
  "APU Command Discipline B",
  "APU Command Discipline",
  "Instructions",
  "APU Instructions",
  "Command Level Instructions",
  "Formalized Training",
  "APU Formalized Training",
  "APU Closed: Retained, with discipline",
  "APU Retained, with discipline",
  // Judgment call, human-approved (design doc §2): the dataset separately
  // and explicitly labels "APU Closed: Terminated" as its own distinct
  // value, which implies termination is never silently folded into
  // generic "with discipline" phrasing elsewhere -- so "with discipline"
  // (no explicit "terminated") is treated as excluding termination.
  "APU Closed: Previously adjudicated, with discipline",
  "APU Previously adjudicated, with discipline",
]);

const NO_ACTION_DISPOSITIONS = new Set([
  "No Disciplinary Action-DUP",
  "No Disciplinary Action-SOL",
  "APU Not guilty",
  "Not Guilty - DCT",
  "Not Guilty - OATH",
  "APU Not guilty after trial-PC Approved",
  "APU Dismissed",
  "APU Closed: Dismissed by APU",
  "Charge Dismissed - DCT",
  "Charge Dismissed - OATH",
  "APU Closed: Charges not served",
  "APU Charges not served",
  "APU Closed: Retained, without discipline",
  "APU Closed: Previously adjudicated, without discipline",
  "APU Retained, without discipline",
  "APU Closed: SOL Expired prior to APU",
  "APU Closed: SOL Expired in APU",
]);

export function mapNypdDispositionToOutcomeType(disposition: string | null): OutcomeType | null {
  if (!disposition) return null;
  if (TERMINATION_DISPOSITIONS.has(disposition)) return "termination";
  if (INTERNAL_DISCIPLINE_DISPOSITIONS.has(disposition)) return "internal_discipline";
  if (NO_ACTION_DISPOSITIONS.has(disposition)) return "no_action";
  return null;
}
```

- [ ] **Step 2: Write the test file**

Create `apps/ingestion/test/nyc-ccrb/disposition.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mapNypdDispositionToOutcomeType } from "../../src/nyc-ccrb/disposition.js";

describe("mapNypdDispositionToOutcomeType", () => {
  it("returns null for null input", () => {
    expect(mapNypdDispositionToOutcomeType(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(mapNypdDispositionToOutcomeType("")).toBeNull();
  });

  it.each([
    ["APU Closed: Terminated", "termination"],
    ["Command Discipline - A", "internal_discipline"],
    ["Command Discipline - B", "internal_discipline"],
    ["APU Command Discipline A", "internal_discipline"],
    ["APU Command Discipline B", "internal_discipline"],
    ["APU Command Discipline", "internal_discipline"],
    ["Instructions", "internal_discipline"],
    ["APU Instructions", "internal_discipline"],
    ["Command Level Instructions", "internal_discipline"],
    ["Formalized Training", "internal_discipline"],
    ["APU Formalized Training", "internal_discipline"],
    ["APU Closed: Retained, with discipline", "internal_discipline"],
    ["APU Retained, with discipline", "internal_discipline"],
    ["APU Closed: Previously adjudicated, with discipline", "internal_discipline"],
    ["APU Previously adjudicated, with discipline", "internal_discipline"],
    ["No Disciplinary Action-DUP", "no_action"],
    ["No Disciplinary Action-SOL", "no_action"],
    ["APU Not guilty", "no_action"],
    ["Not Guilty - DCT", "no_action"],
    ["Not Guilty - OATH", "no_action"],
    ["APU Not guilty after trial-PC Approved", "no_action"],
    ["APU Dismissed", "no_action"],
    ["APU Closed: Dismissed by APU", "no_action"],
    ["Charge Dismissed - DCT", "no_action"],
    ["Charge Dismissed - OATH", "no_action"],
    ["APU Closed: Charges not served", "no_action"],
    ["APU Charges not served", "no_action"],
    ["APU Closed: Retained, without discipline", "no_action"],
    ["APU Closed: Previously adjudicated, without discipline", "no_action"],
    ["APU Retained, without discipline", "no_action"],
    ["APU Closed: SOL Expired prior to APU", "no_action"],
    ["APU Closed: SOL Expired in APU", "no_action"],
  ])("maps %s to %s", (disposition, expected) => {
    expect(mapNypdDispositionToOutcomeType(disposition)).toBe(expected);
  });

  it.each([
    "APU Guilty",
    "Charges and Specifications - Guilty",
    "Plead Guilty - DCT",
    "Plead Guilty - OATH",
    "Guilty - OATH",
    "Negttn-Guilty",
    "Negttn-Nolo contendre",
    "APU Nolo contendere",
    "APU Resolved by plea",
    "APU Closed: Previously adjudicated, discipline not reported",
    "APU - Decision Pending",
    "Filed",
    "APU Closed: MOS Retired",
    "Resigned",
    "Retired",
    "No Finding",
    "APU Closed: Other",
    "DAO case",
    "APU Closed: MOS Deceased",
    "Abated by Death",
    "Some completely unrecognized future disposition string",
  ])("leaves %s unmapped (returns null)", (disposition) => {
    expect(mapNypdDispositionToOutcomeType(disposition)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests and lint**

```bash
npm run --workspace apps/ingestion test
npm run --workspace apps/ingestion lint
```

Expected: all tests pass, lint clean.

- [ ] **Step 4: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/disposition.ts apps/ingestion/test/nyc-ccrb/disposition.test.ts
git commit -m "Add conservative NYC CCRB disposition -> OutcomeType mapping

Maps a human-reviewed subset of the real ~60 distinct
nypd_allegation_disposition values (live-verified against the Socrata
API) onto the outcomes schema's 3 reachable OutcomeType values
(termination, internal_discipline, no_action) -- the other 4 enum
values belong to a civil-suit/prosecution track this data source
doesn't cover. Everything ambiguous (bare 'Guilty'/plea dispositions
that don't state the resulting sanction) or non-disciplinary
(pending/retired/resigned/deceased) is deliberately left unmapped."
```

---

### Task 3: Generic `proposedOutcome` plumbing (`CandidateItem` → `IncidentCandidateProposal`)

**Files:**
- Modify: `packages/ingestion-lib/src/types.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `packages/ingestion-lib/src/queue.ts`
- Modify: `packages/ingestion-lib/src/tests/queue.test.ts`

**Interfaces:**
- Consumes: `OutcomeType` from `@cop/shared-types` (already exists).
- Produces: `CandidateItem.proposedOutcome` and `IncidentCandidateProposal.proposedOutcome` — Task 4 sets the former, Task 5 and Task 6 read the latter.

- [ ] **Step 1: Add `proposedOutcome` to `CandidateItem`**

In `packages/ingestion-lib/src/types.ts`, add to the `import type` line at the top:

```typescript
import type { IncidentType, MatchConfidence, OutcomeType, ReliabilityTier, SourceType } from "@cop/shared-types";
```

In the `CandidateItem` interface, add after the existing `note?: string;` field:

```typescript
  /** A structured disciplinary outcome to create atomically alongside the
   * incident when a reviewer approves this candidate (packages/shared-
   * types's IncidentCandidateProposal carries the identical field through
   * to the review-queue approval flow) -- pipeline-agnostic; not specific
   * to any one source, though NYC CCRB is the first to populate it. */
  proposedOutcome?: { outcomeType: OutcomeType; date?: string; details?: string };
```

- [ ] **Step 2: Add the identical field to `IncidentCandidateProposal`**

In `packages/shared-types/src/index.ts`, in `IncidentCandidateProposal`, add after the existing `externalUrl?: string;` field:

```typescript
  /** A structured disciplinary outcome proposed alongside this incident --
   * created atomically with the incident at approval time (no separate
   * reviewer edit/skip control for it). Pipeline-agnostic: OutcomeType
   * itself isn't specific to any one source. */
  proposedOutcome?: { outcomeType: OutcomeType; date?: string; details?: string };
```

- [ ] **Step 3: Pass it through in `buildProposal`**

In `packages/ingestion-lib/src/queue.ts`'s `buildProposal` function, find the object literal's closing lines:

```typescript
    note: noteParts.length > 0 ? noteParts.join(" ") : undefined,
    externalUrl: item.externalUrl,
  };
}
```

Replace with:

```typescript
    note: noteParts.length > 0 ? noteParts.join(" ") : undefined,
    externalUrl: item.externalUrl,
    proposedOutcome: item.proposedOutcome,
  };
}
```

- [ ] **Step 4: Add a test to `queue.test.ts`**

Add after the existing `"carries officerName (not officerId) forward..."` test:

```typescript
  it("carries proposedOutcome through unchanged when the item includes one", async () => {
    const item: CandidateItem = {
      sourceType: "official_dataset",
      externalRef: "test-outcome-passthrough",
      reliabilityTier: "tier2_official_dataset",
      officerNameAsReported: "Jane Doe",
      departmentNameAsReported: SEED.officers.janeDoe.departmentName,
      incidentType: "use_of_force",
      shortDescription: "A candidate with a structured outcome attached.",
      dateAsReported: "2024-01-15",
      proposedOutcome: { outcomeType: "internal_discipline", date: "2024-02-01", details: "Command Discipline - A" },
    };
    const matchResult = { officerId: SEED.officers.janeDoe.id, confidence: "high" as const };

    try {
      await client.query("BEGIN");
      const { reviewQueueId } = await queueCandidate(client, item, matchResult);
      await client.query("COMMIT");

      const reviewQueueRow = await pool.query(`SELECT proposed_record FROM review_queue WHERE id = $1`, [
        reviewQueueId,
      ]);
      expect(reviewQueueRow.rows[0].proposed_record.proposedOutcome).toEqual({
        outcomeType: "internal_discipline",
        date: "2024-02-01",
        details: "Command Discipline - A",
      });
    } finally {
      client.release();
    }
  });

  it("omits proposedOutcome entirely (not a null placeholder) when the item doesn't include one", async () => {
    const item: CandidateItem = {
      sourceType: "official_dataset",
      externalRef: "test-outcome-absent",
      reliabilityTier: "tier2_official_dataset",
      officerNameAsReported: "Jane Doe",
      departmentNameAsReported: SEED.officers.janeDoe.departmentName,
      incidentType: "use_of_force",
      shortDescription: "A candidate with no outcome attached.",
      dateAsReported: "2024-01-15",
    };
    const matchResult = { officerId: SEED.officers.janeDoe.id, confidence: "high" as const };

    try {
      await client.query("BEGIN");
      const { reviewQueueId } = await queueCandidate(client, item, matchResult);
      await client.query("COMMIT");

      const reviewQueueRow = await pool.query(`SELECT proposed_record FROM review_queue WHERE id = $1`, [
        reviewQueueId,
      ]);
      expect(reviewQueueRow.rows[0].proposed_record.proposedOutcome).toBeUndefined();
    } finally {
      client.release();
    }
  });
```

- [ ] **Step 5: Build and test both packages**

```bash
npm run --workspace packages/shared-types build
npm run --workspace packages/ingestion-lib build
npm run --workspace packages/ingestion-lib test
```

Expected: both builds succeed, all `packages/ingestion-lib` tests pass (including the two new ones and every pre-existing `queue.test.ts` test unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/ingestion-lib/src/types.ts packages/shared-types/src/index.ts packages/ingestion-lib/src/queue.ts packages/ingestion-lib/src/tests/queue.test.ts
git commit -m "Add generic proposedOutcome field to CandidateItem/IncidentCandidateProposal

Pipeline-agnostic plumbing: OutcomeType itself isn't specific to any one
source, so this rides through queueCandidate's existing buildProposal
unchanged, the same way every other CandidateItem field already does.
NYC CCRB is the first pipeline to populate it (next task), but any
future source could use it the same way."
```

---

### Task 4: NYC CCRB pipeline builds the proposed outcome

**Files:**
- Modify: `apps/ingestion/src/nyc-ccrb/run.ts`
- Modify: `apps/ingestion/test/nyc-ccrb/run.test.ts`

**Interfaces:**
- Consumes: `mapNypdDispositionToOutcomeType` (Task 2), `NycCcrbAllegation.closeDate` (Task 1), `CandidateItem.proposedOutcome` (Task 3).
- Produces: nothing new other tasks in this plan depend on directly (Task 7's backfill script calls `mapNypdDispositionToOutcomeType` itself, not anything from `run.ts`).

- [ ] **Step 1: Import the mapping function**

In `apps/ingestion/src/nyc-ccrb/run.ts`, add:

```typescript
import { mapNypdDispositionToOutcomeType } from "./disposition.js";
```

- [ ] **Step 2: Build `proposedOutcome` on the `CandidateItem`**

Find the existing `CandidateItem` object literal construction in the per-allegation loop:

```typescript
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

Replace with:

```typescript
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
```

- [ ] **Step 3: Update the shared test fixture**

In `apps/ingestion/test/nyc-ccrb/run.test.ts`, the `allegation()` helper needs `closeDate` added (required field on `NycCcrbAllegation` per Task 1) and a `nypdDisposition` default that maps to something concrete so existing tests stay predictable. Find:

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

Replace with:

```typescript
function allegation(overrides: Partial<NycCcrbAllegation> = {}): NycCcrbAllegation {
  return {
    complaintId: "201806447",
    complaintOfficerNumber: "1",
    allegationRecordIdentity: "240280",
    fadoType: "Force",
    allegation: "Physical force",
    ccrbDisposition: "Substantiated (Charges)",
    // Deliberately a disposition that maps to null (bare "Guilty" has no
    // stated sanction -- see disposition.ts) so every pre-existing test in
    // this file, none of which were written expecting a proposedOutcome,
    // keeps passing unchanged. Tests that specifically exercise
    // proposedOutcome override this field explicitly.
    nypdDisposition: "APU Guilty",
    officerFirstName: "Alfred",
    officerLastName: "Hernandez",
    shieldNo: "05046",
    taxId: "942643",
    officerRank: "Police Officer",
    officerActive: true,
    incidentDate: "2018-01-05",
    closeDate: "2018-06-01",
    ...overrides,
  };
}
```

- [ ] **Step 4: Add new tests for `proposedOutcome` inclusion/exclusion**

Add after the existing `"queues a low-confidence candidate with a different note..."` test (the "no officer name at all" one):

```typescript
  it("includes proposedOutcome when nypdDisposition maps to a known OutcomeType", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi
      .fn()
      .mockResolvedValue([allegation({ nypdDisposition: "Command Discipline - A", closeDate: "2019-04-10" })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record FROM review_queue rq JOIN sources s ON s.id = rq.source_id WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows[0].proposed_record.proposedOutcome).toEqual({
      outcomeType: "internal_discipline",
      date: "2019-04-10",
      details: "Command Discipline - A",
    });
  });

  it("omits proposedOutcome (not a null placeholder) when nypdDisposition doesn't map to a known OutcomeType", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ nypdDisposition: "APU - Decision Pending" })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record FROM review_queue rq JOIN sources s ON s.id = rq.source_id WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows[0].proposed_record.proposedOutcome).toBeUndefined();
  });

  it("omits proposedOutcome when nypdDisposition itself is null", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ nypdDisposition: null })]);

    await runNycCcrbPipeline(pool, ENV, { fetchNycCcrbAllegations });

    const reviewQueueRows = await pool.query(
      `SELECT rq.proposed_record FROM review_queue rq JOIN sources s ON s.id = rq.source_id WHERE s.external_ref = '201806447:240280'`,
    );
    expect(reviewQueueRows.rows[0].proposed_record.proposedOutcome).toBeUndefined();
  });
```

- [ ] **Step 5: Run tests and lint**

```bash
npm run --workspace apps/ingestion test
npm run --workspace apps/ingestion lint
```

Expected: all tests pass (every pre-existing test in `run.test.ts` continues to pass unchanged, since the default fixture's `nypdDisposition: "APU Guilty"` deliberately maps to `null`), lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/run.ts apps/ingestion/test/nyc-ccrb/run.test.ts
git commit -m "NYC CCRB pipeline proposes a structured outcome when disposition maps

Uses the conservative disposition.ts mapping against each allegation's
nypdDisposition; when it resolves, attaches a proposedOutcome (mapped
type, closeDate, and the raw disposition string preserved as details)
to the CandidateItem so it rides through to the review-queue item.
Omitted (not null) when the mapping doesn't resolve -- matches every
other optional CandidateItem field's existing convention."
```

---

### Task 5: Approval creates the outcome atomically with the incident

**Files:**
- Modify: `apps/api-internal/src/routes/reviewQueue.ts`
- Modify: `apps/api-internal/test/reviewQueue.test.ts`

**Interfaces:**
- Consumes: `IncidentCandidateProposal.proposedOutcome` (Task 3).
- Produces: nothing new other tasks in this plan depend on.

- [ ] **Step 1: Create the outcome in `promoteReviewQueueItem`**

In `apps/api-internal/src/routes/reviewQueue.ts`, in the `else if (proposed.type === "incident_candidate")` branch, find:

```typescript
    const diff = { departmentId, date, incidentType, shortDescription, officerId };
    await writeRecordRevision(client, {
      recordType: "incident",
      recordId: incidentId,
      changeType: "create",
      diff,
      changedBy: reviewerId,
    });
  } else {
```

Replace with:

```typescript
    const diff = { departmentId, date, incidentType, shortDescription, officerId };
    await writeRecordRevision(client, {
      recordType: "incident",
      recordId: incidentId,
      changeType: "create",
      diff,
      changedBy: reviewerId,
    });

    const proposedOutcome = (proposed as IncidentCandidateProposal).proposedOutcome;
    if (proposedOutcome) {
      const outcomeResult = await client.query<{ id: string }>(
        `INSERT INTO outcomes (incident_id, outcome_type, date, details)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [incidentId, proposedOutcome.outcomeType, proposedOutcome.date ?? null, proposedOutcome.details ?? null],
      );
      const outcomeDiff = {
        incidentId,
        outcomeType: proposedOutcome.outcomeType,
        date: proposedOutcome.date ?? null,
        details: proposedOutcome.details ?? null,
      };
      await writeRecordRevision(client, {
        recordType: "outcome",
        recordId: outcomeResult.rows[0].id,
        changeType: "create",
        diff: outcomeDiff,
        changedBy: reviewerId,
      });
    }
  } else {
```

This runs inside the same transaction `promoteReviewQueueItem`'s caller already owns (per this function's own doc comment: "Caller owns the transaction... this function issues multiple statements that must land atomically together"), and applies to both `POST /:id/approve` and `POST /bulk-approve` automatically since both already call this shared function — no separate wiring needed for bulk-approve.

- [ ] **Step 2: Add a test to `reviewQueue.test.ts`**

Add after the existing `"providing edits.officerId lets the same incident_candidate approve successfully"` test:

```typescript
  it("approving an incident_candidate with a proposedOutcome creates the outcome and a record_revisions entry for it", async () => {
    const id = "20000000-0000-0000-0000-000000000003";
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, source_id, match_confidence, status)
       VALUES ($1, $2, $3, 'high', 'pending')`,
      [
        id,
        JSON.stringify({
          type: "incident_candidate",
          officerId: OFFICER_ROBERT_SMITH,
          departmentName: "Springfield Police Department (fictional)",
          incidentType: "use_of_force",
          shortDescription: "A use-of-force incident with a proposed disciplinary outcome.",
          date: "2023-08-01",
          proposedOutcome: { outcomeType: "internal_discipline", date: "2023-09-15", details: "Command Discipline - A" },
        }),
        SOURCE_TIER2_REGISTRY,
      ],
    );
    const before = await countRecordRevisions();

    const res = await request(app)
      .post(`/api/internal/review-queue/${id}/approve`)
      .set(...authHeader(token))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe("approved");

    const incidentRes = await superPool.query<{ id: string }>(
      `SELECT i.id FROM incidents i
         JOIN incident_officers io ON io.incident_id = i.id
        WHERE io.officer_id = $1 AND i.short_description = 'A use-of-force incident with a proposed disciplinary outcome.'`,
      [OFFICER_ROBERT_SMITH],
    );
    expect(incidentRes.rows).toHaveLength(1);
    const incidentId = incidentRes.rows[0].id;

    const outcomeRes = await superPool.query(
      `SELECT outcome_type, date, details FROM outcomes WHERE incident_id = $1`,
      [incidentId],
    );
    expect(outcomeRes.rows).toHaveLength(1);
    expect(outcomeRes.rows[0]).toMatchObject({
      outcome_type: "internal_discipline",
      details: "Command Discipline - A",
    });

    const revisionRes = await superPool.query(
      `SELECT record_type, change_type, changed_by FROM record_revisions
        WHERE record_id = (SELECT id FROM outcomes WHERE incident_id = $1)`,
      [incidentId],
    );
    expect(revisionRes.rows).toHaveLength(1);
    expect(revisionRes.rows[0]).toMatchObject({
      record_type: "outcome",
      change_type: "create",
      changed_by: TEST_ADMIN.id,
    });

    // Two new record_revisions rows this time: one for the incident (same
    // as every incident_candidate approval), one for the outcome.
    expect(await countRecordRevisions()).toBe(before + 2);
  });

  it("approving an incident_candidate with no proposedOutcome creates no outcomes row", async () => {
    const id = "20000000-0000-0000-0000-000000000004";
    await superPool.query(
      `INSERT INTO review_queue (id, proposed_record, source_id, match_confidence, status)
       VALUES ($1, $2, $3, 'high', 'pending')`,
      [
        id,
        JSON.stringify({
          type: "incident_candidate",
          officerId: OFFICER_ROBERT_SMITH,
          departmentName: "Springfield Police Department (fictional)",
          incidentType: "use_of_force",
          shortDescription: "A use-of-force incident with no proposed outcome.",
          date: "2023-08-01",
        }),
        SOURCE_TIER2_REGISTRY,
      ],
    );

    const res = await request(app)
      .post(`/api/internal/review-queue/${id}/approve`)
      .set(...authHeader(token))
      .send({});
    expect(res.status).toBe(200);

    const incidentRes = await superPool.query<{ id: string }>(
      `SELECT i.id FROM incidents i
         JOIN incident_officers io ON io.incident_id = i.id
        WHERE io.officer_id = $1 AND i.short_description = 'A use-of-force incident with no proposed outcome.'`,
      [OFFICER_ROBERT_SMITH],
    );
    expect(incidentRes.rows).toHaveLength(1);

    const outcomeRes = await superPool.query(`SELECT id FROM outcomes WHERE incident_id = $1`, [
      incidentRes.rows[0].id,
    ]);
    expect(outcomeRes.rows).toHaveLength(0);
  });
```

- [ ] **Step 3: Build and test**

```bash
npm run --workspace apps/api-internal build
npm run --workspace apps/api-internal test
```

Expected: build succeeds (type-checks `(proposed as IncidentCandidateProposal).proposedOutcome`), all tests pass (including every pre-existing test in this file, unaffected).

- [ ] **Step 4: Commit**

```bash
git add apps/api-internal/src/routes/reviewQueue.ts apps/api-internal/test/reviewQueue.test.ts
git commit -m "Approving an incident_candidate creates its proposedOutcome atomically

Mirrors the existing manual POST /api/internal/outcomes route's exact
insert/revision shape (same columns, same writeRecordRevision call
shape), inside promoteReviewQueueItem's existing transaction --
changed_by is the approving reviewer's id, unlike the ingestion
pipeline's own pipeline-authored officer-creation paths which use NULL.
Applies to both POST /:id/approve and POST /bulk-approve automatically
since both already share this function."
```

---

### Task 6: Admin UI shows the proposed outcome before approval

**Files:**
- Modify: `apps/admin/src/components/ReviewQueueItemCard.tsx`
- Modify: `apps/admin/src/components/__tests__/ReviewQueueItemCard.test.tsx`
- Modify: `apps/admin/src/fixtures/reviewQueue.ts`

**Interfaces:**
- Consumes: `IncidentCandidateProposal.proposedOutcome` (Task 3).
- Produces: nothing other tasks depend on — this is the last visible piece of this plan.

- [ ] **Step 1: Render the proposed outcome in `renderDetails`**

In `apps/admin/src/components/ReviewQueueItemCard.tsx`'s `renderDetails` function, in the `incident_candidate` branch (the second `return (<dl className="kv-grid">...)` block), find:

```tsx
      {rec.note && (
        <>
          <dt>Note</dt>
          <dd>{rec.note}</dd>
        </>
      )}
    </dl>
  );
}
```

Replace with:

```tsx
      {rec.note && (
        <>
          <dt>Note</dt>
          <dd>{rec.note}</dd>
        </>
      )}
      {rec.proposedOutcome && (
        <>
          <dt>Proposed outcome</dt>
          <dd>
            {rec.proposedOutcome.outcomeType.replace(/_/g, " ")}
            {rec.proposedOutcome.date ? ` — ${formatDate(rec.proposedOutcome.date)}` : ""}
            {rec.proposedOutcome.details ? ` (${rec.proposedOutcome.details})` : ""}
          </dd>
        </>
      )}
    </dl>
  );
}
```

- [ ] **Step 2: Add a fixture with a `proposedOutcome`**

In `apps/admin/src/fixtures/reviewQueue.ts`, the array's last entry (`id: "rq-5"`) is immediately followed by the closing `];`. Insert a new entry right before that closing `];`, after `rq-5`'s entry — do not renumber or reorder the existing entries, since existing tests index into this array positionally, e.g. `reviewQueueFixtures[1]`:

```typescript
  {
    id: "rq-outcome-1",
    proposedRecord: {
      type: "incident_candidate",
      officerId: "off-305",
      departmentName: "New York City Police Department",
      incidentType: "use_of_force",
      shortDescription: "CCRB complaint: Force - Physical force (Substantiated (Charges)).",
      date: "2019-04-10",
      proposedOutcome: { outcomeType: "internal_discipline", date: "2019-06-01", details: "Command Discipline - A" },
    },
    source: {
      id: "src-outcome-1",
      sourceType: "official_dataset",
      url: null,
      publicationDate: null,
      retrievedDate: "2026-07-27",
      reliabilityTier: "tier2_official_dataset",
    },
    matchConfidence: "high",
    status: "pending",
    reviewerId: null,
    reviewedAt: null,
    createdAt: "2026-07-27T10:00:00.000Z",
  },
```

(`url: null` is accurate here, not arbitrary: `Source.url` is `string | null` per `@cop/shared-types`, and the real NYC CCRB pipeline never sets `CandidateItem.externalUrl` at all, so every real `official_dataset` source from this pipeline has `url: null` in production — this fixture matches that reality rather than inventing a fake URL.)

- [ ] **Step 3: Add a test to `ReviewQueueItemCard.test.tsx`**

Add after the existing `"renders an incident_candidate proposal that is already matched to an officer..."` test:

```typescript
  it("renders a proposed outcome when the incident_candidate includes one", () => {
    const item = reviewQueueFixtures.find((i) => i.id === "rq-outcome-1")!;
    renderCard(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText(/internal discipline/)).toBeInTheDocument();
    expect(screen.getByText(/Command Discipline - A/)).toBeInTheDocument();
  });

  it("renders no 'Proposed outcome' row when the incident_candidate has none", () => {
    const item = reviewQueueFixtures[1]; // incident_candidate, no proposedOutcome
    renderCard(<ReviewQueueItemCard item={item} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(screen.queryByText("Proposed outcome")).not.toBeInTheDocument();
  });
```

- [ ] **Step 4: Run tests and lint**

```bash
npm run --workspace apps/admin test
npm run --workspace apps/admin lint
```

Expected: all tests pass (every pre-existing test in this file unaffected, since the new fixture is appended, not inserted, and existing tests index by known id or fixed position), lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/ReviewQueueItemCard.tsx apps/admin/src/components/__tests__/ReviewQueueItemCard.test.tsx apps/admin/src/fixtures/reviewQueue.ts
git commit -m "Admin review-queue card shows a proposed outcome before approval

A reviewer must see this before approving -- it's created automatically
alongside the incident with no separate edit/skip control (design doc
§3), so the review-queue card is the only point a human ever sees it
before it becomes a real record."
```

---

### Task 7: Backfill `proposedOutcome` onto the existing review-queue backlog

**Files:**
- Modify: `apps/ingestion/src/nyc-ccrb/backfillReviewQueue.ts`
- Modify: `apps/ingestion/test/nyc-ccrb/backfillReviewQueue.test.ts`

**Interfaces:**
- Consumes: `mapNypdDispositionToOutcomeType` (Task 2), `NycCcrbAllegation.closeDate` (Task 1).
- Produces: nothing other tasks depend on — this is the last task in this plan.

- [ ] **Step 1: Import the mapping function**

In `apps/ingestion/src/nyc-ccrb/backfillReviewQueue.ts`, add:

```typescript
import { mapNypdDispositionToOutcomeType } from "./disposition.js";
```

- [ ] **Step 2: Restructure the per-allegation loop to resolve officer and outcome independently**

Find the current per-allegation loop body inside `backfillOneConfigRow` (from the `for (const allegation of allegations) {` line through its closing `}`). Replace the entire loop body with:

```typescript
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
```

Check the exact pre-existing loop's opening/closing structure and the `updated` accumulator's declaration before this loop (both already exist in this file from the prior feature) — this replacement must fit into the same surrounding function without duplicating or dropping either.

- [ ] **Step 3: Update the doc comment describing what "updated" means**

Find the file's top-level doc comment (or the `backfillOneConfigRow` function's, whichever currently describes the officer-only resolution) and update it to reflect that this script now independently resolves both officer identity and structured outcomes. Do not invent new prose beyond stating this plainly — one or two sentences added to the existing comment is enough.

- [ ] **Step 4: Update existing tests for the new independent-resolution behavior**

The existing tests in `apps/ingestion/test/nyc-ccrb/backfillReviewQueue.test.ts` use their own local `allegation()` fixture helper (a separate copy from `run.test.ts`'s, not shared). It already defaults `nypdDisposition: "APU Guilty"` — a disposition that deliberately maps to null (see `disposition.ts`) — so no change is needed there; every pre-existing test in this file continues to exercise only officer resolution, unaffected by this task. The only addition needed is `closeDate: "2018-06-01"` (a new required `NycCcrbAllegation` field per Task 1, not yet present in this file's fixture). Add it to the object literal alongside the existing `incidentDate: "2018-01-05"` line.

- [ ] **Step 5: Add new tests for outcome-only and combined resolution**

Add after the existing `"skips an allegation with no taxId"` test:

```typescript
  it("adds proposedOutcome to a pending item even when the officer doesn't resolve", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    // No officer exists with this external_officer_ref -- officer resolution
    // will miss, but outcome resolution is independent and must still apply.
    const queueItemId = await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerName: "Alfred Hernandez",
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "x",
    });

    const fetchNycCcrbAllegations = vi
      .fn()
      .mockResolvedValue([allegation({ nypdDisposition: "Command Discipline - A", closeDate: "2019-04-10" })]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(1);
    const updated = await pool.query(`SELECT proposed_record, match_confidence FROM review_queue WHERE id = $1`, [
      queueItemId,
    ]);
    expect(updated.rows[0].proposed_record.proposedOutcome).toEqual({
      outcomeType: "internal_discipline",
      date: "2019-04-10",
      details: "Command Discipline - A",
    });
    // Officer still didn't resolve -- officerName untouched, confidence
    // unchanged (outcome resolution alone says nothing about officer match).
    expect(updated.rows[0].proposed_record.officerName).toBe("Alfred Hernandez");
    expect(updated.rows[0].match_confidence).toBe("low");
  });

  it("resolves both officerId and proposedOutcome together in one pass when both apply", async () => {
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
      shortDescription: "x",
    });

    const fetchNycCcrbAllegations = vi
      .fn()
      .mockResolvedValue([allegation({ nypdDisposition: "APU Closed: Terminated", closeDate: "2020-01-01" })]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(1);
    const updated = await pool.query(`SELECT proposed_record, match_confidence FROM review_queue WHERE id = $1`, [
      queueItemId,
    ]);
    expect(updated.rows[0].proposed_record.officerId).toBe(officerRow.rows[0].id);
    expect(updated.rows[0].proposed_record.officerName).toBeUndefined();
    expect(updated.rows[0].proposed_record.proposedOutcome).toEqual({
      outcomeType: "termination",
      date: "2020-01-01",
      details: "APU Closed: Terminated",
    });
    expect(updated.rows[0].match_confidence).toBe("high");
  });

  it("is safe to re-run after officer resolution already happened -- adds proposedOutcome without disturbing the existing officerId", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    const officerRow = await pool.query<{ id: string }>(
      `INSERT INTO officers (first_name, last_name, department_id, employment_status, external_officer_ref)
       VALUES ('Alfred', 'Hernandez', $1, 'active', 'nyc_ccrb:942643') RETURNING id`,
      [SEED.departments.nyc.id],
    );
    // Simulates a row already resolved by a prior run of this same script
    // (officerId set, officerName stripped, confidence already high).
    const queueItemId = await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerId: officerRow.rows[0].id,
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "x",
    });
    await pool.query(`UPDATE review_queue SET match_confidence = 'high' WHERE id = $1`, [queueItemId]);

    const fetchNycCcrbAllegations = vi
      .fn()
      .mockResolvedValue([allegation({ nypdDisposition: "Instructions", closeDate: "2021-02-02" })]);
    await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    const updated = await pool.query(`SELECT proposed_record FROM review_queue WHERE id = $1`, [queueItemId]);
    expect(updated.rows[0].proposed_record.officerId).toBe(officerRow.rows[0].id); // unchanged
    expect(updated.rows[0].proposed_record.proposedOutcome).toEqual({
      outcomeType: "internal_discipline",
      date: "2021-02-02",
      details: "Instructions",
    });
  });

  it("does not update a row when neither officer nor outcome resolves", async () => {
    await insertConfig(pool, { departmentName: SEED.departments.nyc.name });
    await insertPendingQueueItem(pool, "201806447:240280", {
      type: "incident_candidate",
      officerName: "Alfred Hernandez",
      departmentName: SEED.departments.nyc.name,
      incidentType: "use_of_force",
      shortDescription: "x",
    });

    const fetchNycCcrbAllegations = vi.fn().mockResolvedValue([allegation({ nypdDisposition: "APU - Decision Pending" })]);
    const results = await runNycCcrbReviewQueueBackfill(pool, ENV, { fetchNycCcrbAllegations });

    expect(results[0].reviewQueueRowsUpdated).toBe(0);
  });
```

Check the exact helper names (`insertPendingQueueItem`, `SEED.departments.nyc.id`) against this test file's actual existing content before writing these — they were established by the prior feature's Task 5 and should already match exactly.

- [ ] **Step 6: Run tests and lint**

```bash
npm run --workspace apps/ingestion test
npm run --workspace apps/ingestion lint
```

Expected: all tests pass (every pre-existing test in this file continues to exercise officer-only resolution correctly, per Step 4's fixture update), lint clean.

- [ ] **Step 7: Commit**

```bash
git add apps/ingestion/src/nyc-ccrb/backfillReviewQueue.ts apps/ingestion/test/nyc-ccrb/backfillReviewQueue.test.ts
git commit -m "Extend backfillReviewQueue.ts to also backfill proposedOutcome

Officer resolution and outcome resolution are independent -- a row can
gain a proposedOutcome even when its officer still doesn't resolve, and
vice versa, so the prior all-or-nothing 'skip if no officer' early exit
is replaced with independent per-field resolution and a dynamic JSON
patch. Safe to re-run in production against the already-once-resolved
backlog: status stays 'pending' until a human approves, so a fresh run
reaches already officer-resolved rows again and can add proposedOutcome
without disturbing their existing officerId."
```

---

## Post-implementation (not a task — operational follow-up, not code)

Once this plan's PR merges and ships to the deployed Render instance, re-run the (now outcome-aware) backfill script once against the deployed database to backfill `proposedOutcome` onto the existing 2,231-item NYC CCRB backlog:

```bash
DATABASE_URL="<deployed INGESTION_DATABASE_URL>" npm run --workspace apps/ingestion backfill:nyc-ccrb-review-queue:built
```

Safe to run even though this exact script already ran once for the officer-only case (Task 7's design note above) — it will reach the same rows again and add `proposedOutcome` where the mapping applies, without disturbing already-resolved `officerId`s.
