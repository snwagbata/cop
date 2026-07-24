# COP — Officer Accountability Database

Design doc: [`DESIGN.md`](./DESIGN.md) (v0.4) — read this first, especially §3
(legal framework) and §7/§10 (review/correction workflow), before touching
the review-queue or public-facing display code. Several UI rules in
`apps/web` and data-handling rules in the API services exist specifically to
satisfy requirements laid out there, not as arbitrary style choices.

This is a Phase 1 build (schema + a working full-stack app against synthetic
seed data) per `DESIGN.md` §11 — **not** connected to any real ingestion
pipeline or real officer/department data, and **not** cleared for public
launch (see §3's Phase 0 prerequisites: legal entity, insurance, counsel
review — none of that has happened; this is local/dev software only).

## Layout

```
packages/shared-types/   API contract shared by every service below
db/                       Postgres migrations + synthetic seed data
apps/api-public/          public read-only API            :4001
apps/api-internal/        reviewer/admin API (auth required) :4002
apps/web/                 public search/officer/department frontend :5173
apps/admin/               reviewer review-queue/disputes frontend  :5175
```

Each `apps/*` and `packages/*` directory has its own README with
service-specific detail. This file just covers running the whole stack
together.

## Running the full stack locally

**1. Postgres.** Either `docker compose up -d` (uses `docker-compose.yml`) or
a local Postgres 16 instance. Then:

```
./db/migrate.sh   # applies db/migrations/*.sql in order
./db/seed.sh      # loads synthetic sample data — see its file header;
                   # none of it is real
```

The seed reviewer (`reviewer@example.org`) has no password yet — set one:

```
DATABASE_URL="postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop" \
  npm run --workspace apps/api-internal create-admin -- --email=reviewer@example.org --password=<pick one>
```

**2. Install + build the shared package** (every app imports its compiled
output, so this has to happen before the apps will type-check or run):

```
npm install
npm run --workspace packages/shared-types build
```

**3. Run each service** (four separate terminals/processes):

```
DATABASE_URL="postgres://cop_public_api:cop_public_dev_only@localhost:5432/cop" \
  npm run --workspace apps/api-public dev        # :4001

DATABASE_URL="postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop" \
  npm run --workspace apps/api-internal dev       # :4002

npm run --workspace apps/web dev                  # :5173, expects api-public on :4001
npm run --workspace apps/admin dev                # :5175, expects api-internal on :4002
```

The frontends read their API base URL from `VITE_API_BASE_URL` (`.env.local`
in each app) — defaults already point at the ports above.

## Why two databases roles, two APIs, two frontends

Not accidental duplication — this is `DESIGN.md` §8/§9's internal/public
separation, enforced at the database layer: `cop_public_api` has no grants at
all on `review_queue`, `reviewers`, `reviewer_sessions`, `record_revisions`,
or the ability to resolve `disputes` (it can only INSERT a new one — see
migration `0016`). `cop_internal_api` can read/write everything except
DELETE (corrections go through `disputes`, never row deletion). Verified
directly against Postgres, not just assumed — see the commit history for the
actual permission-denied checks.

## What's built vs. not

**MVP round** (schema + core loop), verified end-to-end with a real headless
browser: officer search with mandatory disambiguation, officer detail pages
with sourced incidents/outcomes/citations and the DESIGN.md §3 disclaimer/
badge rules, department scorecards, public dispute submission, reviewer
login, review-queue approve/reject, and dispute resolution.

**Post-MVP build-out** (this round), also verified end-to-end, plus a visual
redesign onto `packages/design-system` (minimal, high-UX: shared tokens,
dark mode, accessibility pass) across both frontends:
- Public API: paginated officer browse, the `resolvedDisputes` right-of-reply
  query, a narrow public dispute-status-check endpoint.
- Public web: proper landing page, About/Methodology page, dispute
  status-check page, right-of-reply shown inline on records, officer browse
  page, copy-citation, skip-link + keyboard-operable disambiguation picker.
- Internal API: manual data entry (department/officer/incident/outcome/
  source/citation, each writing `record_revisions`), reviewer management
  (admin-role gated), audit log listing, weekly digest, bulk-approve.
- Admin app: a real officer search-and-select picker (replacing the MVP's
  plain-text-ID rough edge), a "Log a new record" manual-entry flow, a
  Reviewers page, an Audit Log page, a weekly-digest Dashboard as the new
  post-login landing page, and bulk-approve with per-item success/failure.

**Latest round**, also verified end-to-end (build+lint+test across every
affected workspace, plus live browser checks of both flows):
- Officer photo-verification review gate (DESIGN.md §7): `officers` gained
  `photo_confirmed`/`photo_confirmed_by`/`photo_confirmed_at`; an unconfirmed
  `photo_url` is stripped from every public API response (search, browse,
  detail) in SQL, not just the mapping layer; a new admin Photo Review page
  lets any reviewer confirm or reject a pending photo.
- Anonymous, source-protected tip intake (DESIGN.md §12): a public
  `/tips/new` form that collects zero identifying information (no name, no
  IP logging) and feeds the existing review-queue pipeline as a
  `tier4_submitted_unverified`, `low`-confidence `incident_candidate` for a
  reviewer to match and approve like any other candidate record.

**Ingestion pipelines (DESIGN.md §5, full system design in `INGESTION_DESIGN.md`)**:
the federal half of the CourtListener/RECAP court-docket pipeline is built
(`apps/ingestion`, weekly + on-demand via GitHub Actions) — fetches
candidate §1983 filings, uses a Claude Haiku pass to extract an officer name
from unstructured docket party text, matches against existing officers, and
queues a `review_queue` candidate like any other source. Two parts of it
need a live check before real use (documented prominently in the code and
in `INGESTION_DESIGN.md` §3.1): the CourtListener request/response shape
was never verified against their real API (no network path to
`courtlistener.com` from this project's dev environment), and the
extraction prompt was never smoke-tested against a real Anthropic API call
for the same reason.

Still not built: state-court coverage (Juriscraper) for the same pipeline,
decertification registry sync, news monitoring, the rest of the DESIGN.md
§12 backlog (multi-language, saved searches, FOIA tracker, vetted bulk API
export), and an officer-edit API + admin page —
today `POST /api/internal/officers` (create) is the only write path for an
officer, so there's no way to correct/update an existing one after the
fact. When this gets built, it must reset `photo_confirmed` (and
`photo_confirmed_by`/`_at`) to false/NULL whenever `photo_url` changes, or
a reviewer's earlier confirmation would silently carry over to a swapped-in
photo it never actually verified — see migration 0017's comment.

`npm audit` is clean (0 vulnerabilities) as of the vite 7/vitest 4 bump
(dropped the `vite`/`vitest`/`esbuild` dev-server-only advisory,
`GHSA-67mh-4wv8-2f99`) and the react-router 7 bump (dropped
`GHSA-wrjc-x8rr-h8h6` open redirect and `GHSA-337j-9hxr-rhxg` SSR-hydration
constructor injection — the latter was never reachable here since both
frontends are pure client-rendered SPAs with no SSR, but the fix is in
regardless). Both bumps were merged after a full local build+lint+test pass
across every affected workspace plus a live Playwright smoke check of core
routing flows, not just taking Dependabot's word for it.

## A note on parallel-agent verification debris

Both build rounds used multiple background agents working in parallel git
worktrees against this *same* shared local Postgres instance. Their live
verification (logging in, approving records, submitting disputes) writes
real rows into that shared database — every round has needed at least one
full `TRUNCATE ... RESTART IDENTITY CASCADE` + `./db/seed.sh` reseed after
merging, to clear test artifacts before the "seed data" can be trusted as
actually matching `db/seed/0001_synthetic_sample_data.sql`. If officer/
incident/dispute counts ever look off during development, reseed first
before assuming something is broken.
