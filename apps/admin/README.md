# COP Admin — Review Queue

Internal reviewer tool for the COP officer-accountability database. Covers the
review-queue workflow (DESIGN.md §7), the dispute/correction workflow
(DESIGN.md §10), reviewer-authored manual data entry (DESIGN.md Phase 1),
and reviewer/account and audit-log administration. This is a small,
low-traffic internal tool for a trusted reviewer group — see §7's "minimal
effort" framing — so the UI favors low-friction, keyboard-first actions over
visual polish, while sharing `@cop/design-system`'s tokens with the public
site so both read as one product family.

It talks to the **internal API** (`/api/internal/*`, bearer-token auth),
which is a separate service built in this repo concurrently. This app does
not talk to Postgres or any other backend directly.

## Stack

React + TypeScript + Vite, `react-router-dom`. Types come from
`@cop/shared-types` (workspace package) — do not redeclare API shapes
locally. Styling comes from `@cop/design-system` (`tokens.css` + `base.css`,
imported in `main.tsx` ahead of `src/styles.css`, which only adds
admin-specific layout/components on top).

## Setup

From the **repo root**:

```bash
npm install
```

This app is an npm workspace member (`apps/admin`), so `npm install` at the
repo root wires up `@cop/shared-types` and `@cop/design-system` via workspace
symlinks. Because `@cop/shared-types` ships compiled output (`main`/`types`
point at `dist/`), build it once before running the admin app if its `dist/`
isn't already present:

```bash
npm run build -w @cop/shared-types
```

## Configuration

Copy `.env.example` to `.env` (or `.env.local`) and adjust if the internal
API isn't at the default:

```bash
cp apps/admin/.env.example apps/admin/.env
```

```
VITE_API_BASE_URL=http://localhost:4002
```

If unset, the app falls back to `http://localhost:4002`.

## Running

```bash
npm run dev -w @cop/admin
```

Serves on **port 5175** (fixed via `vite.config.ts`, `strictPort: true`) —
deliberately not the Vite default 5173, which the public-facing app in
`apps/web` uses.

Log in with a reviewer's email/password. If no password is set yet for the
seeded `reviewer@example.org` row, bootstrap one from `apps/api-internal`:

```bash
npm run create-admin -w @cop/api-internal -- --email=reviewer@example.org --password=<something>
```

## Other scripts

```bash
npm run build -w @cop/admin     # production build (tsc types are checked separately, see below)
npm run preview -w @cop/admin   # preview the production build, also on 5175
npm run lint -w @cop/admin      # tsc --noEmit
npm test -w @cop/admin          # vitest — component/page tests against fixture data
```

## Structure

```
src/
  api/client.ts          single module all internal-API calls go through:
                          base-URL config, bearer-token attachment, 401
                          handling, typed request/response wrappers, ApiError
  context/AuthContext.tsx  login/logout, token + reviewer persisted to
                            sessionStorage, wires 401s back to /login
  pages/
    LoginPage.tsx
    DashboardPage.tsx     post-login landing page: DESIGN.md §7's weekly
                           digest ("N new candidate records this week, N
                           auto-matched, N need your input")
    ReviewQueuePage.tsx   pending review-queue items; per-item approve/
                           reject plus multi-select + bulk-approve, with a
                           per-item success/failure report from the API
    DisputesPage.tsx      open disputes, resolve form
    NewRecordPage.tsx     reviewer-authored manual entry (source / department
                           / officer / incident / outcome), tabbed, chained
                           via a session-local cache (see below)
    AuditLogPage.tsx      record_revisions, filterable by record type,
                           paginated, expandable JSON diff per row
    ReviewersPage.tsx     admin-only: list/add reviewers, change role,
                           deactivate/reactivate
  components/
    ReviewQueueItemCard.tsx   renders an officer_candidate or
                               incident_candidate proposal, its source
                               (URL + reliability tier), match confidence,
                               bulk-select checkbox, and the approve/reject
                               actions; an unmatched incident_candidate
                               resolves via OfficerSearchPicker
    OfficerSearchPicker.tsx   debounced search-and-select against
                               GET /api/internal/officers/search; "single"
                               mode (review-queue resolution) shows a
                               persistent selected chip, "multi" mode
                               (incident form) resets after each pick so the
                               caller can build a list
    new-record/*.tsx          NewSourceForm, NewDepartmentForm,
                               NewOfficerForm, NewIncidentForm,
                               NewOutcomeForm — one per manual-entry tab
    DisputeCard.tsx           renders a dispute + inline resolve form
    Layout.tsx                skip-link, top-nav (role-gated Reviewers
                               link), <main id="main">
    ErrorBanner.tsx
  fixtures/               fixture data matching @cop/shared-types exactly —
                           used by the component/page tests, and useful as a
                           reference for exact field shapes when wiring the
                           real API up
```

## Manual data-entry: known simplification

`NewRecordPage` chains its five tabs (source → department → officer →
incident → outcome) using an in-memory, session-local cache of what's been
created so far (populated as each form succeeds), rather than fetching
existing records from the server. This is a deliberate simplification: there
is no `GET /api/internal/sources` (or departments/incidents) list endpoint in
the current internal-API contract to page through existing records instead.
Concretely:

- **Sources**: source-creation-only. There's no way to browse/attach a
  previously-created source from an earlier session; a reviewer citing an
  older source has to paste its id manually (department/incident forms also
  accept a free-text id with a session-cache `<datalist>` for convenience).
- **Departments / incidents**: same pattern — a `<datalist>` of
  this-session's creations, plus a free-text id fallback for anything older.
- **Officers**: the incident form's officer picker uses the same
  `OfficerSearchPicker` as review-queue resolution (a real server-backed
  search), so an officer created in an *earlier* session is fully findable
  once the search index reflects it; only officers created *this session* get
  the extra "quick-add" convenience buttons in case search indexing lags a
  same-session create.

If a real list/search endpoint for sources (and ideally departments/
incidents) is added later, `NewRecordPage`'s tabs should switch from the
session cache to fetching real data — the session cache was the pragmatic
choice given the current endpoint set, not the intended long-term shape.

## Known rough edges / intentional simplifications

- **Reject reason** is a plain inline text field (not a browser `prompt()`,
  not a structured reason-code enum).
- Token storage is in-memory + `sessionStorage` — fine for an internal tool,
  not a hardened auth store (no rotation, no httpOnly cookie, survives only
  the tab session).
- `createReviewer`'s response shape isn't spelled out beyond `Reviewer` in
  `@cop/shared-types`; `updateReviewer` similarly. Both are typed as
  returning a bare `Reviewer` in `api/client.ts` — adjust if the real API
  wraps it differently (e.g. `{ reviewer }`).
- The manual-entry "created record" shapes (`CreatedOfficer`, `CreatedSource`,
  etc. in `api/client.ts`) are modeled locally as "the request fields plus an
  assigned id," since `@cop/shared-types` only specifies the
  `CreateRecordResponse<T>` envelope, not `T` itself, for these endpoints.

## Verification status

Verified against a **live** internal API + Postgres in this environment
(not just fixtures/mocks):

- Logged in as the seeded reviewer (`reviewer@example.org`), confirmed the
  full-page flow: dashboard digest → review queue (approve/reject/bulk-
  approve) → disputes → new-record forms → audit log → reviewers.
- `GET /api/internal/review-queue/digest` renders real weekly-digest numbers
  on the dashboard.
- `GET /api/internal/officers/search?q=` renders live candidates in
  `OfficerSearchPicker`; selecting one and approving sends
  `edits.officerId` through to the real approve endpoint end-to-end.
- `POST /api/internal/review-queue/bulk-approve` was exercised against a
  low-confidence seed item and correctly reported it as failed with the
  server's own reason (`Bulk approval requires match_confidence "high" (got
  "low")`) rather than silently succeeding — the review-queue page's
  approved/failed report renders that per-item detail.
- Reject flow removes the item and updates the audit log / digest.
- `GET /api/internal/record-revisions` and `GET /api/internal/reviewers`
  render real rows (seed data + a reviewer created live through the "Add
  reviewer" form).
- Confirmed the admin-only `/reviewers` guard two ways: the nav link is
  hidden for a `role: "reviewer"` account, and direct navigation to
  `/reviewers` redirects to `/`; separately confirmed the API itself 403s a
  non-admin bearer token against `GET /api/internal/reviewers` (the real
  backstop, not just the UI hide).
- Skip-link + keyboard focus verified: first `Tab` from a fresh page focuses
  a visible "Skip to content" link that jumps to `<main id="main">`.
- Dark mode verified via `prefers-color-scheme: dark` — all pages restyle
  correctly off `@cop/design-system/tokens.css` with no bespoke dark-mode
  CSS needed in this app beyond what tokens.css already provides.
- `npm run lint -w @cop/admin` (tsc --noEmit), `npm run build -w @cop/admin`,
  and `npm test -w @cop/admin` (31 tests: the original 17 plus 14 new,
  covering `OfficerSearchPicker`, the dashboard, reviewers page, audit log,
  and bulk-approve) all pass.

Also verified live, once the internal API caught up on these endpoints
during this work: the full manual-entry chain in `/new-record` —
source → department → officer → incident → outcome — created real rows
end-to-end (confirmed real UUIDs returned and rendered at each step,
including the incident form's live `OfficerSearchPicker` result and its
source-citation checkboxes) via `POST /api/internal/departments`,
`/officers`, `/incidents`, `/outcomes`, `/sources`.

**Not verified**: `POST /api/internal/citations` specifically (no UI path
in this pass creates a citation independent of the `sourceIds` passed
directly on incident/outcome creation), and `PATCH /api/internal/reviewers/
:id`'s exact response shape beyond what the live "Deactivate" toggle
exercised. If any create/update response shape ends up different from what
`@cop/shared-types`'s `Create*Request`/`CreateRecordResponse<T>` implies,
the fix is localized to `api/client.ts`'s wrappers and the small `Created*`
local types next to them.
