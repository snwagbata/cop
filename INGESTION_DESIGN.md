# Ingestion Pipelines — System Design

Design doc for DESIGN.md §5 ("Ingestion Pipelines"), which so far has only been
a table of sources and a one-paragraph pipeline shape. This expands it into an
actual buildable design, scoped around one hard constraint the product doesn't
have room to compromise on: **near-zero recurring cost**. This is a
public-interest project with no funding model, so "high powered" here means
*maximum extraction quality per dollar*, not "throw compute at it."

Every pipeline in this doc ends the same way regardless of source: a row in
`sources` and a row in `review_queue`. Nothing ever writes to a public-facing
table directly — that invariant (DESIGN.md §3/§7) doesn't change here, it's
just now fed by six automated pipelines instead of the admin app's manual
entry form and the tip-intake form.

## 1. Cost philosophy

Three cost centers, in order of how much they actually cost:

| Cost center | Approach | Monthly cost |
|---|---|---|
| Compute (fetch/parse/schedule) | GitHub Actions scheduled workflows | **$0** |
| Data sources | CourtListener, GDELT, MuckRock, state registries, RSS — all free/public APIs | **$0** |
| Extraction (unstructured text → structured candidate) | Cheap-tier LLM (Claude Haiku), gated behind a free local pre-filter | **$0–~$5**, tunable to exactly $0 |

The only line item with a real dial on it is LLM extraction, so every pipeline
that uses one is designed so that dial can be turned to zero (falls back to
pure regex/keyword extraction, at a real cost in false negatives) without
breaking anything else. That's a deliberate design constraint, not a "nice to
have" — it means the whole system stays $0/month if the project's cost
tolerance is truly zero, and only starts costing single-digit dollars if
someone deliberately opts into higher recall.

**Why GitHub Actions and not a real scheduler/queue (e.g. a cron box, AWS
Lambda + EventBridge, Render Cron Jobs):** it's free (public repo: unlimited
minutes; private repo: 2,000 free minutes/month, which this project's actual
job volume won't come close to), it needs no infrastructure to operate or
patch, secrets management is built in (repo secrets), and every run's logs
are automatically retained and inspectable — which turns out to matter a lot
for unattended jobs pulling from flaky government/news sources. The tradeoff:
scheduled workflows aren't guaranteed to fire at the exact minute (GitHub
documents delays up to ~15 min under load) and the shortest supported
interval is 5 minutes — irrelevant for jobs that realistically run daily or
weekly.

## 2. Common pipeline shape

Every pipeline is a standalone TypeScript script (`tsx`, matching the
existing `apps/api-internal/scripts/create-admin.ts` convention — no new
language/runtime to maintain), invoked by its own GitHub Actions workflow on
a cron schedule, connecting directly to Postgres via `cop_internal_api`
(same role the admin API uses — no new DB role needed). Shared logic lives in
a new workspace, `packages/ingestion-lib`:

```
fetch (source-specific)
  → normalize (source-specific → a common CandidateItem shape)
  → dedupe (external_ref lookup — skip items already queued from a prior run)
  → local pre-filter (regex/keyword — cheap, $0, runs on everything)
  → [optional] LLM structured extraction (only on pre-filter survivors)
  → entity match (fuzzy-match officer/department name against existing tables,
     reusing the same pg_trgm approach the internal officer-search endpoint
     already uses — DESIGN.md §6)
  → INSERT sources row (source_type, url, reliability_tier, external_ref)
  → INSERT review_queue row (proposed_record, match_confidence, source_id)
  → log an ingestion_runs row (counts, errors, duration)
```

`match_confidence` is decided the same way DESIGN.md §6 already specifies for
manual entry: high-confidence `post_certification_id` match → `high`;
name/badge/department match only → `medium`; no confident match, or the
primary/secondary signals disagree → `low`, unconditionally (§6's conflict
rule). No pipeline is ever allowed to write `match_confidence: 'high'` off a
fuzzy name match alone — that's enforced in the shared matching helper, not
left to each pipeline to get right.

### Schema additions this requires

Two real gaps in the current schema, needed before *any* automated pipeline
can run safely and repeatably:

```sql
-- Dedup key so a pipeline that runs daily doesn't re-queue the same court
-- filing or registry row every single day. Nullable/unenforced for manual
-- entry and the tip-intake form (they don't have a natural external id);
-- unique only when present, scoped per source_type so two different sources
-- can't collide on the same literal string.
ALTER TABLE sources ADD COLUMN external_ref text;
CREATE UNIQUE INDEX sources_source_type_external_ref_idx
    ON sources (source_type, external_ref) WHERE external_ref IS NOT NULL;

-- Per-run audit log — required for debugging six unattended cron jobs.
-- Without this, a silently-failing scraper (a state registry changes its
-- HTML structure, an API starts 403ing) has no visibility until someone
-- notices the review queue went quiet for that source.
CREATE TABLE ingestion_runs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type      text NOT NULL,
    started_at       timestamptz NOT NULL,
    finished_at      timestamptz,
    items_fetched    integer NOT NULL DEFAULT 0,
    items_queued     integer NOT NULL DEFAULT 0,
    items_deduped    integer NOT NULL DEFAULT 0,
    error            text
);

-- Data-driven pipeline config, so "add a state registry" or "add a
-- keyword/department to watch" is an admin-app row edit, not a code change
-- + deploy. Read by the relevant pipeline script at the start of each run.
CREATE TABLE ingestion_configs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type      text NOT NULL,
    enabled          boolean NOT NULL DEFAULT true,
    config           jsonb NOT NULL,   -- shape is source_type-specific: state code + registry URL, RSS feed list, keyword list, etc.
    last_run_at      timestamptz
);
```

`ingestion_runs` should get a small admin-app page (a read-only table,
similar to Audit Log) so a reviewer can see at a glance which pipelines are
healthy — this is the observability layer, and it's free (it's just another
page reading from Postgres, same as everything else in the admin app).

## 3. Per-source design

### 3.1 CourtListener / RECAP (§1983 filings) — build first

**Why first:** DESIGN.md's own table already calls this "structured,
low-noise, highest value-per-effort," and it's the cleanest fit for a
zero-cost pipeline — CourtListener's REST API is free, well-documented, has
a generous rate limit for registered (free) API keys, and full-text search
across RECAP-available federal filings. This is explicitly the free
alternative to raw PACER (which charges per page) that DESIGN.md already
calls out.

- **Fetch**: CourtListener's search API, querying for `nature_of_suit` civil
  rights filings (§1983) with department-name keyword matching, using each
  `ingestion_configs` row's list of watched department/jurisdiction names.
  Free API key, no cost.
- **Extraction**: docket metadata (parties, filing date, court, docket
  number) comes back structured — no LLM needed for the citation itself.
  Officer name extraction from the docket text *is* unstructured (defendant
  names on a civil rights complaint aren't reliably tagged as "officer" vs.
  "department" vs. "city"), so this is the one place in this pipeline an LLM
  pass earns its cost: one Haiku call per candidate docket, prompted to
  return a strict JSON list of `{name, role}` guesses, function-call/schema
  constrained. Volume here is naturally low (federal §1983 filings per
  department per week are single digits to low dozens), so the LLM cost for
  this specific pipeline realistically stays under $1/month even switched on.
- **Dedup key**: CourtListener's docket id.
- **Reliability tier**: `tier1_primary_legal_doc` (it's literally a court
  filing).

### 3.2 State decertification registries

**Why second:** DESIGN.md calls this the best source for
`post_certification_id` — the primary cross-department identity key (§6) —
so getting this pipeline live materially improves every *other* pipeline's
match confidence, not just its own data.

- **Fetch**: source-specific per state — no two states publish this the same
  way. Some publish clean CSV/JSON (trivial fetch+diff); some are an HTML
  table (cheerio scrape); a few are PDF-only (would need PDF table
  extraction, meaningfully harder — deprioritize those states until the
  CSV/HTML states are live and the pattern is proven).
- **Recommendation**: build this as a plugin architecture from day one —
  one small adapter module per state implementing a shared
  `fetchDecertifications(): DecertificationRow[]` interface — rather than
  one monolithic script, since this is the pipeline most likely to grow
  incrementally (one state at a time) over the project's life. Pilot with
  1–2 states that publish structured CSV/JSON exports before touching any
  PDF-only state.
- **Extraction**: none needed — these are already structured government
  datasets. $0 LLM cost, always.
- **Dedup key**: state + registry's own row id (or officer name + revocation
  date if the registry has no stable id — a real risk to flag: some
  registries don't expose one, which would need a synthesized fingerprint,
  e.g. a hash of name+date+state, accepting a small false-dedup risk).
- **Reliability tier**: `tier2_official_dataset`.
- **Etiquette**: identify with a real `User-Agent` naming the project, cap
  request rate (~1 req/sec), and respect `robots.txt` — these are public
  government sites, not adversarial scraping targets, but courtesy avoids
  ever getting IP-blocked and keeps this in clearly-fine legal territory
  (public records, not circumventing any access control).

### 3.3 Existing open datasets (LLEAD, Police Records Access Project, National Police Index)

**Why third:** the easiest pipeline in this entire doc — these projects
already did the entity-resolution work. This is a periodic bulk-diff-import
job, not really a "monitoring" pipeline.

- **Fetch**: whatever bulk export format each project publishes (CSV/JSON
  dumps, sometimes a real API). Weekly or monthly cadence — these datasets
  don't change fast.
- **Extraction**: none — already structured. $0 LLM cost, always.
- **Dedup key**: upstream project's own row id, namespaced by which project.
- **Reliability tier**: `tier2_official_dataset` (treat these as vetted
  aggregators, same tier as an official government dataset — they're
  themselves built from public records, and don't duplicate the human
  verification effort DESIGN.md explicitly wants to avoid redoing).
- **Note**: attribute clearly (source URL in the `sources` row already
  handles this) and check each project's terms of use/license before bulk
  import — most of these are explicitly built for reuse, but confirm per
  project rather than assuming.

### 3.4 News monitoring

**Why fourth, and why this design specifically:** highest noise-to-signal
ratio of any source in this doc, so it's the pipeline most worth being
careful about cost on. Two free discovery layers instead of one, feeding one
cheap local pre-filter, before any LLM spend:

- **Discovery — layer 1, GDELT**: the GDELT Project's DOC 2.0 API is a
  genuinely free, high-volume, real-time global news index built for exactly
  this kind of keyword/entity monitoring — an underused resource for a
  "free but powerful" news pipeline. Query per watched department/keyword
  combination (from `ingestion_configs`) on a daily cadence.
- **Discovery — layer 2, RSS**: local news outlets' own RSS feeds (most
  local papers/TV stations publish one) plus Google News RSS search feeds
  (`news.google.com/rss/search?q=...`, free, no key) as a second, overlapping
  discovery source — catches smaller/local stories GDELT's broader index
  might not surface promptly.
- **Local pre-filter (free, runs on every discovered item before any LLM
  call)**: keyword match against the department name plus a fixed phrase
  list (`"sustained complaint"`, `"internal affairs"`, `"body camera"`,
  `"excessive force"`, `"officer-involved"`, etc., per DESIGN.md §5's
  existing suggested keyword set) — pure regex, $0, and the thing that keeps
  LLM spend near zero by only letting genuinely promising articles through.
- **Extraction (only for pre-filter survivors)**: fetch the article's own
  page, extract a short excerpt around the keyword match (not the full
  article text — both a legal/fair-use consideration and a storage-cost
  one), one Haiku call per candidate to pull officer name / incident
  type / date into the `IncidentCandidateProposal` shape. This is the
  pipeline where LLM cost could actually add up if volume is high — cap it
  with a daily per-source budget (e.g. max N LLM calls/day from
  `ingestion_configs`) so a noisy news day can't spike cost unexpectedly.
- **Dedup key**: article URL (normalized — strip tracking query params).
- **Reliability tier**: `tier3_established_news` — always routed to full
  manual review regardless of match confidence, per DESIGN.md §7's existing
  rule (tier3 is never eligible for one-click/bulk approval).
- **Fallback to $0**: with the LLM step off, this pipeline still works —
  it just queues the raw excerpt + matched keywords as a `low`-confidence,
  `officerId` unset candidate for the reviewer to read and structure by
  hand, same as a tip-intake submission. Lower automation quality, zero cost.

### 3.5 FOIA / public records requests (MuckRock)

**Why fifth:** genuinely useful but the *fulfillment* half can't be
automated at all (a human at the department has to respond), so the
leverage-per-effort here is inherently lower than the sources above.

- **Automatable half**: MuckRock has a free API for filing and tracking
  public-records requests on a schedule — e.g., a quarterly boilerplate
  request to a watched department asking for updated disciplinary/complaint
  records. $0 cost (MuckRock's API is free; filing fees, if any particular
  jurisdiction charges one, are a separate real-money cost outside this
  design's scope and would need a human decision per request, not something
  a cron job should ever authorize on its own).
- **Non-automatable half**: when a request is fulfilled, the response
  document needs the same manual-heavy handling as internal-affairs PDFs
  below (§3.6) — this pipeline's "automation" is really just *tracking*
  request status and creating a review-queue reminder when a response
  arrives, not extracting anything from the response itself.
- **Reliability tier**: `tier2_official_dataset` once fulfilled (it's an
  official department response) — but nothing gets auto-queued until a
  human confirms a document actually arrived; this pipeline only ever
  creates a *task*, never a candidate record, until then.

### 3.6 Internal affairs findings (PDFs) — defer

**Why last:** DESIGN.md already calls this "manual-heavy... format varies
wildly by department," and that doesn't change. Free OCR (Tesseract, run
locally in the GitHub Actions job — no paid OCR API needed) can extract raw
text from a PDF, but turning "raw OCR'd text of an arbitrary internal-affairs
PDF" into a structured candidate reliably is a much harder extraction problem
than news-article snippets, and this project doesn't have real intake volume
for it yet (no pipeline is feeding it PDFs today — that only starts happening
once FOIA fulfillments in §3.5 start arriving). Recommend deferring actual
build work here until there's a real backlog of PDFs to process, and revisit
with whatever's learned from the news-monitoring extraction pipeline (§3.4)
first, since the LLM-extraction pattern transfers directly.

### 3.7 Body cam footage / tips — already built

Covered by the tip-intake feature (DESIGN.md §12, shipped this session) —
included here only for completeness against DESIGN.md §5's original table.
No further pipeline work needed; tips already land in `review_queue` the
same way every other source in this doc will.

## 4. Rollout order

1. **CourtListener/RECAP** (§3.1) — free API, structured data, highest
   value-per-effort, lowest LLM dependency.
2. **Schema additions** (§2) — `external_ref`, `ingestion_runs`,
   `ingestion_configs` — needed before #1 can actually run on a recurring
   schedule without duplicate-queuing itself.
3. **State decertification registries**, 1–2 pilot states (§3.2) — improves
   every later pipeline's match quality via `post_certification_id`.
4. **Open dataset sync** (§3.3) — cheapest possible next win, almost no new
   code beyond a fetch+diff loop.
5. **News monitoring** (§3.4) — the one pipeline worth watching cost on;
   ship with the LLM step *off* by default, let it be opted into per
   `ingestion_configs` row once the pre-filter's precision is validated
   against a couple weeks of real (queued-but-not-approved) output.
6. **MuckRock FOIA filing/tracking** (§3.5).
7. **Internal-affairs PDF OCR** (§3.6) — deferred until §3.5 produces a real
   backlog.

## 5. Observability, without spending anything

- `ingestion_runs` table (§2) + a read-only admin-app page, same pattern as
  the existing Audit Log page.
- A GitHub Actions **job summary** per run (built into every workflow run
  for free) showing fetched/queued/deduped/error counts at a glance without
  opening the admin app.
- Optional: a free Slack or Discord incoming webhook posting a daily digest
  ("14 new candidates across 3 sources, 1 pipeline errored") — genuinely
  $0, and ties the automated pipelines into the same "keep review effort low
  but not zero" philosophy DESIGN.md §7 already establishes for the human
  side of review.

## 6. Open questions before building

- Which 1–2 states should be the decertification-registry pilot? Needs a
  state that (a) publishes a structured (CSV/JSON, not PDF-only) registry
  and (b) is actually relevant to whatever departments this instance's seed
  data / real launch scope cares about.
- Confirm each open dataset's (§3.3) license/terms explicitly allows bulk
  reuse before importing — likely fine, but a 5-minute check per source, not
  an assumption.
- Where does the LLM API key live for a public GitHub repo's Actions
  workflow? Standard answer is a repo secret (never exposed to
  fork-triggered PR workflows, which don't get secrets by default) — worth
  confirming this repo's Actions settings match that expectation before the
  news-monitoring pipeline (§3.4) goes anywhere near a real key.
