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

Still not built: any real ingestion pipeline (decertification registry sync,
news monitoring, court docket monitoring — DESIGN.md §5, Phase 2+), the
officer disambiguation photo-verification review gate's UI (backend rule
exists; no photo test data yet), and the rest of the DESIGN.md §12 backlog
(multi-language, saved searches, FOIA tracker, vetted bulk API export,
anonymous tip intake).

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
