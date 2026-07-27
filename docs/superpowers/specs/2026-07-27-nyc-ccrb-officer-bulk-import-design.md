# NYC CCRB officer bulk-import + pipeline officer-resolution fix — design

## Problem

The first real NYC CCRB ingestion run (2026-07-27, workflow run 30262470705)
succeeded — 2,231 real allegations fetched and queued, 0 errors. But every
single one landed in `review_queue` with `officerId: null` and
`match_confidence: 'low'`, because NYPD has zero rows in `officers` — the
department was onboarded with no roster, so `matchOfficer` (which only
matches against *existing* officers) has nothing to match against. This
isn't a bug in `matchOfficer`; it's a missing prerequisite: you can't match
incidents to officers before any officers exist.

NYC CCRB's Socrata catalog includes a full Officers reference dataset
(`2fir-qns4`) that the pipeline already partially uses (joined by `tax_id`
for name/shield only) — 97,551 rows total, live-verified via `$select=count(tax_id)`.
Each row carries far more than the pipeline currently extracts:

```json
{"tax_id":"865782","active_per_last_reported_status":"No","officer_first_name":"Chris",
 "officer_last_name":"Dengel","current_rank_abbreviation":"SGT","current_rank":"Sergeant",
 "current_command":"HWY 03","shield_no":"01717","total_complaints":"0",
 "total_substantiated_complaints":"0"}
```

This design bulk-imports that entire dataset once as NYPD's officer roster,
fixes the weekly pipeline to resolve officers against it going forward, and
backfills the 2,231 already-queued items so they resolve too.

**Known scope limitation, not fixed here:** the weekly pipeline only ingests
newly-closed complaints in a rolling 30-day window (INGESTION_DESIGN.md §3.2's
original design choice), not a full historical incident backfill. Most of the
97,551 imported officers will show zero visible incidents at first, even
though CCRB's own aggregate `total_complaints`/`total_substantiated_complaints`
fields (not stored — no column for them today) show many have real history.
"All officers now exist" is not the same as "all their history is visible."
That's a separate, larger future initiative if wanted.

## 1. New column: `officers.external_officer_ref`

New migration `db/migrations/0020_officer_external_ref.sql` (next number
after 0019):

```sql
ALTER TABLE officers ADD COLUMN external_officer_ref text;
CREATE UNIQUE INDEX officers_external_officer_ref_idx
    ON officers (external_officer_ref)
    WHERE external_officer_ref IS NOT NULL;
```

**No new grant needed.** This project has been bitten twice before by a
missing-grant mistake on a newly-added table (migrations 0016, 0018) — but
this is a new *column* on an already-granted table, not a new table.
Migration 0015's `GRANT SELECT, INSERT, UPDATE ON officers, record_revisions,
... TO cop_internal_api` (the role every ingestion pipeline connects as,
confirmed by migration 0019's own comment) already covers all columns of
those tables, including ones added later via `ALTER TABLE`. Worth confirming
against a real `cop_internal_api`-role connection during implementation
anyway, same discipline 0019 used, rather than assuming.

Generic and namespaced (`"nyc_ccrb:<tax_id>"`), mirroring `sources.external_ref`'s
own namespacing-by-source-type convention (migration 0019) — reusable by any
future department/source that has its own stable per-officer id, not
NYC-CCRB-specific. Nullable: manually-created officers and officers from
sources with no stable id (e.g. name-only registries) never set it.

**Not reused:** `post_certification_id` (a *state* POST decertification id —
a different concept) and `badge_number` (a real public-facing shield number
reviewers see on the officer page — conflating it with an internal
dedup key would confuse them, per the earlier design discussion this
project already had about this exact question).

## 2. One-time bulk-import script

New script, run once manually (not on the weekly schedule) against
whichever database it targets (local or deployed):
`apps/ingestion/src/nyc-ccrb/backfill-officers.ts`, wired to a new
`npm run --workspace apps/ingestion backfill:nyc-ccrb-officers` script.

**Fetch:** paginate the *entire* `2fir-qns4` dataset (no `tax_id in (...)`
scoping — unlike the weekly pipeline's join, this fetches everything),
`$limit=1000` per page, following `next`/count until exhausted (~98 pages).

**Field mapping** (using the richer fields the weekly pipeline's join
currently ignores):

| Officers dataset field | `officers` column | Notes |
|---|---|---|
| `officer_first_name` | `first_name` | required; row skipped if absent |
| `officer_last_name` | `last_name` | required; row skipped if absent |
| `shield_no` | `badge_number` | nullable in source |
| `current_rank` | `rank` | nullable in source (e.g. `"Sergeant"`) |
| `active_per_last_reported_status` | `employment_status` | `"Yes"` → `'active'`, `"No"`/missing → `'inactive'` |
| `tax_id` | `external_officer_ref` | as `nyc_ccrb:<tax_id>`; row skipped if `tax_id` absent (no dedup key) |
| *(fixed)* | `department_id` | NYPD's id, looked up once by department name at script start |

**Insert strategy — batched, not one-row-per-transaction.** The existing
weekly pipeline's one-transaction-per-item pattern (see
`apps/ingestion/src/nyc-ccrb/run.ts`) is correct for its own reasons (atomic
`sources`+`review_queue` pairing, crash-resilience across a long run) but
does not scale to 97,551 rows — at the ~1-row-per-5-6-seconds rate observed
in the real 2,231-item production run, that pattern would take on the order
of days. Instead, batch officers using `unnest()` to pass whole columns as
array-valued parameters rather than one bind placeholder per row-per-column
— this sidesteps Postgres's 65,535-parameter ceiling entirely regardless of
batch size (`unnest()` takes exactly 7 parameters total, one array each, no
matter how many rows are inside each array). Chunk at 2,000 rows/statement
anyway, not for a parameter-count limit, but for practical progress
visibility (log "imported N/97,551" between chunks) and to keep any single
statement's memory/lock footprint modest:

```sql
INSERT INTO officers
    (first_name, last_name, department_id, badge_number, rank, employment_status, external_officer_ref)
SELECT * FROM unnest(
    $1::text[], $2::text[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[]
)
ON CONFLICT (external_officer_ref) WHERE external_officer_ref IS NOT NULL DO NOTHING
RETURNING id, external_officer_ref;
```

Re-running the script is safe (idempotent) — already-imported officers
(matched by `external_officer_ref`) are skipped via `ON CONFLICT ... DO
NOTHING`, so a re-run only inserts genuinely new rows since the last run.

**`record_revisions` audit trail**, also batched (not one row per officer):
using the `id`s actually `RETURNING`-ed from each batch's `ON CONFLICT DO
NOTHING` insert (conflicting/skipped rows are never returned, so this only
logs real creations), a second batched insert:

```sql
INSERT INTO record_revisions (record_type, record_id, change_type, diff, changed_by)
SELECT 'officer', id, 'create',
       jsonb_build_object('source', 'nyc_ccrb_officer_bulk_import', 'external_officer_ref', external_officer_ref),
       NULL
FROM unnest($1::uuid[], $2::text[]) AS t(id, external_officer_ref);
```

`changed_by = NULL` — nullable per migration 0011 (`changed_by uuid
REFERENCES reviewers (id)`, no `NOT NULL`) — represents system/pipeline
authorship rather than a specific human reviewer, same convention this
design already confirmed with the user for the weekly pipeline's own
create-on-miss path (below).

**Visibility:** confirmed with the user — these officer records are
immediately public via the existing officer search/detail APIs, same as any
other officer row, no new "unverified" gate. The name/department/badge data
comes directly from NYPD/CCRB's own published roster (their employer, not a
guess), and `record_revisions` preserves the full audit trail either way.

## 3. Weekly pipeline: surface `taxId`, resolve by `external_officer_ref` first

**`apps/ingestion/src/nyc-ccrb/client.ts`:** `NycCcrbAllegation` currently
swallows `tax_id` during `normalizeAllegation` — it's used only internally
to join officer name/shield, never surfaced. Add three fields the bulk
importer also uses, so the weekly pipeline's rare create-on-miss path (next
section) has the same accurate data the bulk import does, instead of
defaulting `employment_status` to `'active'` unconditionally:

```typescript
export interface NycCcrbAllegation {
  // ...existing fields unchanged...
  taxId: string | null;
  officerRank: string | null;
  officerActive: boolean | null; // from active_per_last_reported_status, null if field absent
}
```

`RawOfficerRow` gains `current_rank?: string` and
`active_per_last_reported_status?: string`; `normalizeAllegation` maps them
through (`"Yes"` → `true`, anything else present → `false`, absent → `null`)
the same way the bulk importer does.

**`apps/ingestion/src/nyc-ccrb/run.ts`:** replace the single `matchOfficer`
call with a two-step resolution per allegation:

1. If `allegation.taxId` is set, look up
   `SELECT id FROM officers WHERE external_officer_ref = $1` (`nyc_ccrb:<taxId>`).
   Found → `{ officerId, confidence: 'high' }` immediately, skip fuzzy
   matching entirely (a tax-id hit is authoritative — this mirrors
   `matchOfficer`'s own rule 1 for `postCertificationId`). After the bulk
   import lands, this is expected to hit for ~100% of allegations; it only
   misses for an officer newly added to CCRB's dataset since the last bulk
   import run.
2. Not found (rare) → fall back to today's `matchOfficer(pool, { name,
   departmentName })` call unchanged, in case a reviewer already manually
   created a matching officer. If that also misses, create a new officer
   row on the spot using `allegation.officerFirstName/officerLastName/
   shieldNo/officerRank/officerActive/taxId` (same field mapping as the bulk
   importer, single-row insert — this path is expected to be rare, so no
   batching needed here), write one `record_revisions` row
   (`changed_by: NULL`), and use `{ officerId: newId, confidence: 'high' }`.

Deliberately **not** done: if step 2's `matchOfficer` fuzzy match succeeds
(medium confidence), do **not** stamp `external_officer_ref` onto that
existing officer. Promoting a fuzzy, possibly-wrong name match into a
permanent hard identity link would compound a wrong guess into every future
run automatically resolving to it at `'high'` confidence — exactly the kind
of auto-resolved ambiguity DESIGN.md §6 already prohibits for a reason.

## 4. Backfill the 2,231 already-queued items

New one-time script, `apps/ingestion/src/nyc-ccrb/backfill-review-queue.ts`
(`npm run --workspace apps/ingestion backfill:nyc-ccrb-review-queue`), run
**after** the officer bulk import (step 2) so lookups actually hit:

1. Re-fetch allegations via the same (now taxId-surfacing)
   `fetchNycCcrbAllegations` — cheap; the slow part of the original run was
   the per-row DB writes, not the upfront Socrata fetch.
2. For each fetched allegation, compute the same `externalRef =
   "${complaintId}:${allegationRecordIdentity}"` used at ingestion time, and
   find the matching `review_queue` row via its `source_id`'s
   `sources.external_ref` (join `review_queue.source_id = sources.id WHERE
   sources.external_ref = $1 AND review_queue.status = 'pending'` — only
   still-`pending` rows are touched; anything a reviewer already
   approved/rejected by hand is left alone).
3. If `allegation.taxId` resolves via `external_officer_ref` (expected to
   hit near-100% post-bulk-import), update that row in place:
   ```sql
   UPDATE review_queue
      SET proposed_record = (proposed_record - 'officerName') || jsonb_build_object('officerId', $1::text),
          match_confidence = 'high'
    WHERE id = $2
   ```
   (`- 'officerName'` preserves `IncidentCandidateProposal`'s documented
   invariant — "officerId set when matched, officerName set when not, never
   both" — the same invariant `queueCandidate`'s `buildProposal` already
   enforces at write time.)
4. Rows where resolution still fails (no `taxId` on the original allegation,
   or matched to a genuinely-brand-new officer added since the bulk import)
   are left exactly as they are today — same manual-resolution path already
   available via the existing officer search picker + `edits.officerId` on
   approve.

This script is a one-time operational tool, same category as the existing
`scratch_*` one-off checks this session already used against the deployed
database — not part of any scheduled workflow.

## Out of scope

- Full historical incident backfill (only newly-closed complaints going
  forward are ever ingested as incidents — a separate future initiative,
  noted above).
- Storing `total_complaints`/`total_substantiated_complaints` on `officers`
  (no column exists for either today; not needed for this fix).
- `officer_department_history` rows for bulk-imported officers — mirrors the
  existing manual `POST /api/internal/officers` creation path, which also
  leaves `departmentHistory: []` at creation time (that table is populated
  by the separate, not-yet-built "transfer" feature, per the existing code
  comment in `officers.ts`).
- Rate-limiting/backoff for the CourtListener pipeline (a real, separately-flagged
  gap in `apps/ingestion/src/courtlistener/client.ts`, unrelated to NYC CCRB
  and to this design).
