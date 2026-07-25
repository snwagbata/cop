# NYC CCRB ingestion pipeline — design

## Problem

INGESTION_DESIGN.md §3.2 ("State decertification registries") calls for a
pilot covering 1-2 sources that publish structured (CSV/JSON, not
PDF-only) misconduct/decertification data, on the theory that state POST
boards would be the source. In practice, every state POST board checked
during this design pass turned out to be a dead end for automation:

- **Georgia**: $25 fee, mailed on physical media, not downloadable.
- **Connecticut**: PDF only.
- **Illinois**: a name-lookup web tool, no bulk export found.
- **California**: public-records-request only (GovQA portal).

INGESTION_DESIGN.md §3.2 itself names the fallback: "Also watch city/county
Open Data portals... usually Socrata-based, with a free public API...
often *better* structured than a state's own registry." Two candidates
were checked directly against their live schemas:

- **Chicago COPA/BIA** (`data.cityofchicago.org`): real, free, documented
  Socrata API — but every complaint/allegation dataset is fully
  anonymized (race/sex/age/years-on-force only, no officer name or badge).
  Disqualified — this pipeline's whole purpose is producing a candidate
  matchable to a specific officer record.
- **NYC CCRB** (`data.cityofnewyork.us`): real, free, documented Socrata
  API, with genuine officer identity fields. Verified live via direct API
  calls during this design pass (not from documentation alone).

This spec covers **NYC CCRB only**. The adapter interface (§4) is kept
generic enough that a second source is a follow-up adapter, not a rewrite,
but no second source ships in this pass.

## 1. Data source — verified schema

Three Socrata (SODA2) datasets on `data.cityofnewyork.us`, confirmed live
via unauthenticated `GET` requests during this design pass (no app token
required; CORS-open; standard `X-SODA2-*` response headers). Base URL
pattern: `https://data.cityofnewyork.us/resource/{four-four}.json`.

### `2fir-qns4` — CCRB: Police Officers

One row per NYPD member of service, as reported to CCRB by NYPD's roster.

| Field | Type | Notes |
|---|---|---|
| `tax_id` | text | NYPD's unique per-officer identifier — the join key to Allegations. |
| `officer_first_name` / `officer_last_name` | text | |
| `shield_no` | text | Badge number. |
| `current_rank` / `current_rank_abbreviation` | text | |
| `current_command` | text | Current precinct/unit. |
| `active_per_last_reported_status` | text | `Yes`/`No`. |
| `total_complaints` / `total_substantiated_complaints` | number | Running totals as of `as_of_date`. |

### `6xgr-kwjq` — CCRB: Allegations Against Police Officers

One row per (complaint, officer, allegation) triple — a single complaint
can name multiple officers and multiple allegations; this table is already
exploded to one row per allegation-officer pair, which is the natural
`CandidateItem` granularity for this pipeline.

| Field | Type | Notes |
|---|---|---|
| `complaint_id` | text | Joins to the Complaints table. |
| `complaint_officer_number` | text | Disambiguates multiple officers on one complaint. |
| `tax_id` | text | Joins to the Police Officers table. |
| `officer_rank_at_incident` / `officer_command_at_incident` | text | Rank/command *at the time of the incident* (may differ from current). |
| `fado_type` | text | Top-level category: `Force`, `Abuse of Authority`, `Discourtesy`, `Offensive Language`. |
| `allegation` | text | Specific allegation within that category (e.g. `Physical force`). |
| `ccrb_allegation_disposition` | text | e.g. `Substantiated (Charges)`, `Unsubstantiated`, `Exonerated`. |
| `nypd_allegation_disposition` | text | NYPD's own disposition, when different from CCRB's. |

### `2mby-ccnw` — CCRB: Complaints Against Police Officers

One row per complaint (not per officer — join via `complaint_id`).

| Field | Type | Notes |
|---|---|---|
| `complaint_id` | text | Primary key, joins Allegations. |
| `incident_date` | timestamp | |
| `borough_of_incident_occurrence` / `precinct_of_incident_occurrence` | text | |
| `reason_for_police_contact` | text | |
| `ccrb_complaint_disposition` | text | Complaint-level (vs. Allegations' allegation-level) disposition. |

### Sample rows (captured live during this design pass)

```json
// 2fir-qns4
{"tax_id":"979800","officer_first_name":"Christine","officer_last_name":"Cuenca",
 "current_rank":"Police Officer","current_command":"062 PCT","shield_no":"12152",
 "total_complaints":"0","total_substantiated_complaints":"0"}

// 6xgr-kwjq
{"complaint_id":"201806447","complaint_officer_number":"1","tax_id":"942643",
 "officer_rank_at_incident":"Police Officer","officer_command_at_incident":"077 PCT",
 "fado_type":"Force","allegation":"Physical force",
 "ccrb_allegation_disposition":"Substantiated (Charges)","nypd_allegation_disposition":"APU Guilty"}
```

## 2. Schema/seed addition

`matchOfficer` (`packages/ingestion-lib/src/match.ts`) requires an exact
(case-insensitive) `departments.name` match against whatever
`departmentName` a pipeline provides — there is no fuzzy matching on
department name, only on officer name. Since this instance's only seeded
departments are the fictional Springfield/Shelbyville ones
(`db/seed/0001_synthetic_sample_data.sql`), a real NYC pipeline would
never resolve a department match without a real department row to match
against.

**Add one real department row**, in a **new, separate seed file** —
deliberately not merged into `0001_synthetic_sample_data.sql`, whose own
header comment states everything in it is fictional placeholder data. A
new file keeps that invariant legible for future maintainers rather than
quietly breaking it:

`db/seed/0002_nyc_pilot_department.sql`:

```sql
-- Real department, unlike 0001's fictional Springfield/Shelbyville rows --
-- added specifically to let the NYC CCRB ingestion pipeline
-- (INGESTION_DESIGN.md §3.2) resolve a department match. This is a public
-- entity (a city police department's existence is not sensitive), not
-- officer data -- no real officer/incident/outcome rows are seeded here or
-- anywhere else in this repo. DEPLOYMENT.md's "don't deploy real officer
-- data" constraint is about officer-level records, which this does not add.

BEGIN;

INSERT INTO departments (name, state, jurisdiction_type, contact_info, records_request_portal_url) VALUES
    ('New York City Police Department', 'NY', 'municipal', NULL, 'https://a860-openrecords.nyc.gov/');

COMMIT;
```

**Consequence, stated plainly**: adding the department alone does not make
matches resolve above `low` confidence — `matchOfficer`'s rule 2 requires
an existing `officers` row to fuzzy-match the incoming name against, and
none exist yet for NYPD. Every candidate this pipeline queues will be
`low`/unmatched until a reviewer approves the first NYC officer records
through the normal `review_queue` flow, at which point later runs start
resolving matches against those. This is correct, expected behavior for a
newly-onboarded department, not a bug to fix in this pass.

## 3. Pipeline architecture

Follows INGESTION_DESIGN.md §2's common shape, reusing
`packages/ingestion-lib` exactly as the CourtListener pipeline
(`apps/ingestion/src/courtlistener/`) already does — `hasBeenQueued`,
`matchOfficer`, `queueCandidate`, `startRun`/`finishRun`. New files:

- `apps/ingestion/src/nyc-ccrb/client.ts` — Socrata fetch + join logic
  (§4 below). Isolated in its own file per the same convention
  `courtlistener/client.ts` already established, since this is the piece
  most likely to need adjustment if NYC changes dataset IDs/fields.
- `apps/ingestion/src/nyc-ccrb/run.ts` — orchestration: read enabled
  `ingestion_configs` rows with `source_type = 'nyc_ccrb'`, loop, dedupe,
  match, queue, log. **No extraction/LLM step** — unlike
  `courtlistener/run.ts`, there is no `extract.ts`, since every field
  needed is already structured and typed in the source data.
- `.github/workflows/ingest-nyc-ccrb.yml` — weekly cron
  (`ingest-courtlistener.yml`'s cadence and `workflow_dispatch` convention),
  no new secrets required to *run* (public unauthenticated API), one
  optional secret to *improve reliability* (§6).

## 4. Fetch strategy

The Allegations dataset is a full snapshot, not an append-only event feed,
so each run queries a trailing window and relies on the existing
`external_ref` dedup (unique per `(source_type, external_ref)`, from
`db/migrations/0019_ingestion_foundation.sql`) to skip repeats across
overlapping windows — the same robustness pattern
`courtlistener/run.ts` already uses for its own re-run safety.

```
GET https://data.cityofnewyork.us/resource/6xgr-kwjq.json
    ?$where=complaint_id IN (
        SELECT complaint_id FROM ... -- see note below, actually expressed as a date filter
      )
    &$limit=1000&$offset=0
```

Concretely: `$where=as_of_date >= '<30 days before this run>'` (the
Allegations table's `as_of_date` reflects when the snapshot row was last
generated, which moves forward as CCRB processes/closes cases — a 30-day
trailing window catches recently-closed allegations with margin, at the
cost of re-fetching some already-seen rows on every run, which
`hasBeenQueued` filters out cheaply before any DB write). Paginate with
`$limit`/`$offset` (Socrata's standard SODA2 pagination) until a page
returns fewer than `$limit` rows.

For each allegation row: join to `2fir-qns4` by `tax_id` (a second
`$where=tax_id IN (...)` batched query per page, not one request per row)
to get `officer_first_name`/`officer_last_name`/`shield_no`. Joining to
the Complaints table (`2mby-ccnw`) by `complaint_id` for `incident_date`
is optional/nice-to-have (a third batched query) — include it if it's a
clean addition, but the pipeline is fully functional without it since
Allegations alone has everything required for a valid `CandidateItem`.

**Etiquette**: real `User-Agent` naming the project, matching
INGESTION_DESIGN.md §3.2's stated convention for registry pipelines even
though Socrata's own rate limiting (not `robots.txt`) is the actual
constraint here.

## 5. CandidateItem mapping

```ts
{
  sourceType: "official_dataset",           // packages/shared-types' SourceType is exactly
                                             // "court_doc" | "news_article" |
                                             // "public_records_response" | "official_dataset" |
                                             // "decertification_registry" | "tip_submission"
                                             // (verified). CCRB is a complaint/allegation
                                             // database, not a decertification list -- NYPD
                                             // doesn't decertify via CCRB -- so
                                             // "official_dataset" is the correct category, not
                                             // "decertification_registry" despite this pipeline
                                             // living in INGESTION_DESIGN.md's §3.2 section of
                                             // that same name
  externalUrl: undefined,                   // CCRB doesn't expose a per-complaint public URL
  externalRef: `${complaint_id}:${complaint_officer_number}`,
  reliabilityTier: "tier2_official_dataset",
  officerNameAsReported: `${officer_first_name} ${officer_last_name}`,
  departmentNameAsReported: "New York City Police Department",
  incidentType: fado_type === "Force" ? "use_of_force" : "other",
                                             // packages/shared-types' IncidentType is exactly
                                             // "use_of_force" | "false_report" | "unlawful_arrest"
                                             // | "other" (verified in packages/shared-types/src/index.ts).
                                             // CCRB's four fado_type categories (Force, Abuse of
                                             // Authority, Discourtesy, Offensive Language) only
                                             // overlap that enum at "Force" -> "use_of_force";
                                             // the other three have no matching category and fall
                                             // to "other" -- not a placeholder, a real 1:1 mapping
                                             // for the one category that lines up and a deliberate
                                             // fallback for the three that don't
  shortDescription: `CCRB complaint: ${fado_type} - ${allegation} (${ccrb_allegation_disposition}).`,
  dateAsReported: incident_date ?? undefined,  // from the optional Complaints join
  note: shield_no
    ? undefined
    : "No shield number on file for this officer in NYPD's CCRB roster -- verify identity before approving.",
}
```

`matchOfficer` gets called with `{ name: officerNameAsReported,
departmentName: "New York City Police Department" }` — no
`postCertificationId` (CCRB doesn't have one; NYPD shield numbers are not
the same namespace as this schema's `post_certification_id`, which is a
state POST-issued identifier — conflating them would be a real correctness
bug, not a simplification).

## 6. Config & secrets

`ingestion_configs` row, `source_type = 'nyc_ccrb'`:

```json
{ "departmentName": "New York City Police Department" }
```

No per-precinct filtering in this first pass (unlike CourtListener's
per-keyword config) — NYC CCRB covers exactly one department (NYPD), so
there's nothing to parameterize yet. If a second city is added later, its
`ingestion_configs` row is what varies, not this pipeline's code.

**Secrets**: none required to run. One optional repo secret,
`SOCRATA_APP_TOKEN` (free to obtain from NYC Open Data, raises the
unauthenticated rate-limit ceiling), read via `process.env.SOCRATA_APP_TOKEN`
and sent as the `X-App-Token` header when present; omitted entirely when
not set (SODA2 works fine without one at this pipeline's actual volume —
weekly, one department). This keeps INGESTION_DESIGN.md §1's "$0, no
required secrets" cost philosophy intact while leaving a documented lever
if NYC's unauthenticated rate limit ever becomes a real constraint.

## 7. Testing

Mirrors `apps/ingestion/test/courtlistener/`'s structure: `client.test.ts`
(mocked HTTP responses — the exact JSON shapes captured live in §1 above
are good fixture material), `run.test.ts` (orchestration against a real
Postgres test DB with `client` mocked, same pattern
`courtlistener/run.test.ts` already uses). No `extract.test.ts` equivalent
needed (no extraction step). CI never hits the real Socrata API, matching
this repo's existing convention of no live external calls in the test
suite.

## Out of scope

- A second source/city (Philadelphia PAB, etc.) — the adapter shape here
  supports it as a future addition, not built now.
- Seeding real NYC officer records — only the department row is added
  (§2); populating real officers happens through the normal
  `review_queue` → reviewer-approval flow once this pipeline is live and
  producing candidates, not via seed data.
- The Complaints table (`2mby-ccnw`) join for `incident_date` is optional
  nice-to-have, not required for a correct `CandidateItem` (§4).
