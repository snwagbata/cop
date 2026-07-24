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
just now fed by several automated (or crowdsourced) pipelines instead of
just the admin app's manual entry form and the tip-intake form.

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

**Not every source is poll-based, though.** Where a source can push instead
(CourtListener saved-search alerts, §3.1; the "suggest a source" form, §3.9),
there's no cron schedule at all — the item arrives via a webhook/POST
request to one new lightweight route bolted onto the already-running
`apps/api-internal` service (genuinely free marginal cost, since that
service is already deployed and always-on; no second host to stand up just
to receive webhooks). From that route onward, a pushed item goes through the
exact same normalize → dedupe → pre-filter → [LLM] → match → queue shape as
a polled one — the only thing that differs between "push" and "poll" sources
is what triggers step one.

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

-- Per-run audit log — required for debugging several unattended, mostly
-- unmonitored pipelines. Without this, a silently-failing scraper (a state
-- registry changes its HTML structure, an API starts 403ing) has no
-- visibility until someone notices the review queue went quiet for that
-- source. Applies to poll-based pipelines only — the push-based ones
-- (§3.1's CourtListener alerts, §3.9's tip form) log per-request instead of
-- per-run, so a row here with a NULL finished_at persisting past its
-- expected schedule is itself the signal something's wrong.
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

### 3.1 Court dockets — CourtListener/RECAP (federal) + Juriscraper (state) — build first

**Why first:** DESIGN.md's own table already calls this "structured,
low-noise, highest value-per-effort," and it's the cleanest fit for a
zero-cost pipeline — CourtListener's REST API is free, well-documented, has
a generous rate limit for registered (free) API keys, and full-text search
across RECAP-available federal filings. This is explicitly the free
alternative to raw PACER (which charges per page) that DESIGN.md already
calls out.

**Federal — CourtListener/RECAP, push not poll:**
- **Fetch**: instead of polling CourtListener's search API on a schedule,
  create a saved search per watched department/jurisdiction (`nature_of_suit`
  civil rights filings, §1983) and let CourtListener notify on match — lower
  load on their API, closer to real-time than a daily poll, still free.
  Delivered as a webhook/RSS to the shared receiver route described in §2.
  Fall back to scheduled polling of the search API only if their alerting
  doesn't cover a given jurisdiction well enough in practice.
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

**State courts — Juriscraper, not a bespoke scraper per state:** RECAP only
covers federal courts, and most misconduct-relevant civil suits against
individual officers are filed in state court, not federal. Rather than
writing state-court scrapers from scratch, reuse **Juriscraper** — an
open-source library maintained by the Free Law Project (the same
organization behind CourtListener/RECAP) with scrapers already written for
dozens of state court systems. Run it as a subprocess from the pipeline
script, normalize its output into the same `CandidateItem` shape as the
federal path, and feed it through the identical LLM-extraction step above.
This is the single biggest "don't reinvent the wheel" win in this whole
design — building state-court coverage from zero would otherwise be its own
multi-month project.

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
- **Also watch city/county Open Data portals, not just state registries**:
  several major cities run their own civilian complaint review boards with
  public data (NYC's CCRB, Chicago's COPA, Philadelphia's PAB) published
  through their city's Open Data portal — usually Socrata-based, with a free
  public API. Structurally identical pipeline to a state registry (fetch,
  no LLM extraction needed, `tier2_official_dataset`), just at the city
  level instead of the state level, and often *better* structured than a
  state's own registry since these are purpose-built oversight datasets.

### 3.3 Existing open datasets (LLEAD, Police Records Access Project, National Police Index, Washington Post police-shootings, Mapping Police Violence, Fatal Encounters)

**Why third:** the easiest pipeline in this entire doc — these projects
already did the entity-resolution work. This is a periodic bulk-diff-import
job, not really a "monitoring" pipeline. Worth naming the concrete sources
rather than leaving this generic:
- **`washingtonpost/data-police-shootings`** — the Washington Post's own
  actively-maintained public GitHub repo, CSV, no API key, trivial to sync
  (a periodic `git pull` + diff is genuinely all this pipeline needs).
- **Mapping Police Violence** and **Fatal Encounters** — independent,
  actively-maintained open datasets, fatal-incident focus.
- **LLEAD, Police Records Access Project, National Police Index** — broader
  misconduct-record aggregators, DESIGN.md's original picks.

- **Fetch**: whatever bulk export format each project publishes (CSV/JSON
  dumps, a GitHub repo, sometimes a real API). Weekly or monthly cadence —
  these datasets don't change fast.
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

### 3.6 DocumentCloud

**Why this matters more than its position in the list suggests:**
DocumentCloud (run by the same nonprofit lineage as MuckRock — journalism
infrastructure, not a generic document host) is where journalists already
upload primary-source documents they've obtained, including police
misconduct files, disciplinary records, and FOIA responses — with OCR
already done and full-text search exposed through a free API. This is
effectively free, pre-vetted source discovery: instead of this project
doing its own OCR/extraction work on a raw PDF (§3.7 below), a meaningful
fraction of the relevant documents may already exist on DocumentCloud in
searchable form, uploaded by someone who's already done the hard part.

- **Fetch**: DocumentCloud's search API, queried per watched department
  name, on a weekly cadence (this is a slow-moving source — new documents
  don't appear constantly).
- **Extraction**: same LLM structured-extraction step as news monitoring
  (§3.4) — DocumentCloud gives full OCR'd text, not just an excerpt, so
  extraction quality here should actually be *better* than the news
  pipeline's short-excerpt approach.
- **Dedup key**: DocumentCloud's own document id.
- **Reliability tier**: depends on the underlying document — a court filing
  hosted there is still `tier1_primary_legal_doc`, an internal-affairs
  finding is closer to `tier2_official_dataset`; carry through whatever the
  uploading journalist tagged it as if DocumentCloud exposes that, otherwise
  default conservatively to the lower tier and let a reviewer confirm.
- **Practical effect on §3.7**: this substantially shrinks that pipeline's
  real scope — the OCR/extraction problem there only needs solving for
  documents that *aren't* already on DocumentCloud, which is a smaller and
  less urgent set than "all internal-affairs PDFs everywhere."

### 3.7 Internal affairs findings (PDFs) — defer

**Why last:** DESIGN.md already calls this "manual-heavy... format varies
wildly by department," and that doesn't change. Free OCR (Tesseract, run
locally in the GitHub Actions job — no paid OCR API needed) can extract raw
text from a PDF, but turning "raw OCR'd text of an arbitrary internal-affairs
PDF" into a structured candidate reliably is a much harder extraction problem
than news-article snippets, and this project doesn't have real intake volume
for it yet (no pipeline is feeding it PDFs today — that only starts happening
once FOIA fulfillments in §3.5 start arriving, and even then §3.6 covers a
meaningful chunk of it for free). Recommend deferring actual build work here
until there's a real backlog of PDFs DocumentCloud doesn't already cover,
and revisit with whatever's learned from the news-monitoring extraction
pipeline (§3.4) first, since the LLM-extraction pattern transfers directly.

### 3.8 Body cam footage / tips — already built

Covered by the tip-intake feature (DESIGN.md §12, shipped this session) —
included here only for completeness against DESIGN.md §5's original table.
No further pipeline work needed; tips already land in `review_queue` the
same way every other source in this doc will.

### 3.9 "Suggest a source" — extend tip intake, don't rebuild it

**The idea:** most of this project's actual audience — attorneys,
journalists, advocates who already know it exists — will occasionally have
a specific document or article in hand (a court filing, a news story, a
FOIA response) rather than a raw firsthand account. Right now the tip form
(§3.8) is framed entirely around "something I witnessed," even though its
existing `externalUrl` field already supports "here's a link to something I
found." This costs almost nothing to build because the backend plumbing
already exists end to end — `POST /api/public/tips` already accepts
`externalUrl`, already lands in `review_queue` as a `low`-confidence
candidate, already requires a reviewer to match and approve it.
- **What's actually new**: UI framing only. A lightweight toggle on
  `/tips/new` — "I witnessed this" vs. "I found a document about this" —
  that adjusts placeholder copy and which field is emphasized
  (`description` vs. `externalUrl`), not a new endpoint or schema.
- **Why it's worth calling out separately from §3.8 anyway**: this is a
  *human discovery* channel that scales with the project's own audience
  growth, at zero marginal engineering cost per new source it turns up — a
  meaningfully different value proposition than any scraper in this doc,
  worth actively promoting (e.g. from the About/Methodology page) once the
  UI framing ships, not just leaving passively available.

## 4. Rollout order

1. **"Suggest a source" UI framing** (§3.9) — not really a pipeline at all,
   just a copy/UI change on a form that's already shipped. Ship this first
   simply because it's nearly free and doesn't wait on anything else below.
2. **Schema additions** (§2) — `external_ref`, `ingestion_runs`,
   `ingestion_configs` — needed before any *automated* pipeline below can
   run on a recurring schedule without duplicate-queuing itself.
3. **CourtListener/RECAP + Juriscraper** (§3.1) — free, structured, highest
   value-per-effort, lowest LLM dependency; Juriscraper in particular is the
   single biggest scope-reduction move in this whole doc (state-court
   coverage without writing state-court scrapers).
4. **State + city/county registries**, 1–2 pilots (§3.2) — improves every
   later pipeline's match quality via `post_certification_id`.
5. **Open dataset sync** (§3.3) — cheapest possible next win, almost no new
   code beyond a fetch+diff loop; the Washington Post GitHub repo is likely
   the single easiest source in this entire document to stand up.
6. **DocumentCloud** (§3.6) — free, pre-vetted, OCR already done — good
   value relative to how little novel pipeline logic it needs (mostly reuses
   the news-monitoring extraction step, §3.4).
7. **News monitoring** (§3.4) — the one pipeline worth watching cost on;
   ship with the LLM step *off* by default, let it be opted into per
   `ingestion_configs` row once the pre-filter's precision is validated
   against a couple weeks of real (queued-but-not-approved) output.
8. **MuckRock FOIA filing/tracking** (§3.5).
9. **Internal-affairs PDF OCR** (§3.7) — deferred until §3.5/§3.6 leave a
   real backlog DocumentCloud doesn't already cover.

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

**Explicitly out of scope, and why:**
- **IADLEST's National Decertification Index** would be the single best
  possible national aggregation source for exactly what §3.2 is trying to
  build — but it's restricted to law-enforcement agencies for hiring
  background checks, not publicly queryable. Naming this plainly rather than
  pretending it's reachable: it isn't, and no amount of clever scraping
  changes that, since it's access-controlled, not just hard to find.
- **Social media monitoring** (X/Twitter, Reddit) was considered and
  deliberately left out of every pipeline above. X's API isn't meaningfully
  free anymore, and unverified social posts are exactly the accuracy risk
  DESIGN.md §6 is built to guard against. Where a viral post is genuinely
  the first sign of something real, the right path is a human filing it
  through §3.9's tip form, not an automated pipeline that ingests
  unverified claims at social-media volume and velocity.
