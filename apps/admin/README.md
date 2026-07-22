# COP Admin — Review Queue

Internal reviewer tool for the COP officer-accountability database. Covers the
review-queue workflow (DESIGN.md §7) and the dispute/correction workflow
(DESIGN.md §10). This is a small, low-traffic internal tool for a trusted
reviewer group — see §7's "minimal effort" framing — so the UI favors
low-friction actions over visual polish.

It talks to the **internal API** (`/api/internal/*`, bearer-token auth),
which is a separate service built in this repo concurrently. This app does
not talk to Postgres or any other backend directly.

## Stack

React + TypeScript + Vite, `react-router-dom` for the two authenticated
routes, no other UI framework. Types come from `@cop/shared-types`
(workspace package) — do not redeclare API shapes locally.

## Setup

From the **repo root**:

```bash
npm install
```

This app is an npm workspace member (`apps/admin`), so `npm install` at the
repo root wires up `@cop/shared-types` via a workspace symlink. Because
`@cop/shared-types` ships compiled output (`main`/`types` point at `dist/`),
build it once before running the admin app if its `dist/` isn't already
present:

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
`apps/public` (built in a parallel worktree) uses.

Log in with a reviewer's email/password (see the internal API repo/worktree
for how reviewer accounts get bootstrapped — this app doesn't manage
accounts, just consumes `/api/internal/auth/login`).

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
    ReviewQueuePage.tsx   pending review-queue items, approve/reject
    DisputesPage.tsx      open disputes, resolve form
  components/
    ReviewQueueItemCard.tsx   renders an officer_candidate or
                               incident_candidate proposal, its source
                               (URL + reliability tier), match confidence,
                               and the approve/reject actions
    DisputeCard.tsx           renders a dispute + inline resolve form
    Layout.tsx, ErrorBanner.tsx
  fixtures/               fixture data matching @cop/shared-types exactly —
                           used by the component/page tests, and useful as a
                           reference for exact field shapes when wiring the
                           real API up
```

## Known rough edges (intentional, called out in the task spec)

- **Officer-ID entry on unmatched incident approvals.** When approving an
  `incident_candidate` whose `proposedRecord.officerId` is absent, the API
  requires `edits.officerId` or it 400s. Rather than a full officer-search
  picker (out of scope for this MVP), the reviewer just types the officer's
  ID into a plain text field on the card. This is a real usability gap —
  a reviewer has to already know the ID — noted here rather than silently
  shipped as if it were a finished picker.
- **Reject reason** is a plain inline text field (not a browser `prompt()`,
  not a structured reason-code enum) — matches the "prompt for a short
  reason" spec literally as an on-page prompt rather than a native dialog.
- Token storage is in-memory + `sessionStorage`, which is fine for an
  internal MVP tool but is not a hardened auth store (no rotation, no
  httpOnly cookie, survives only the tab session).

## Verification status

The internal API was **not reachable** while this app was built (confirmed
via `curl http://localhost:4002/api/internal/review-queue` returning
connection-refused, not a 401 — the port had no listener at all — checked
both at the start and end of this work). As a result:

- **Not verified**: the live login → review-queue → approve/reject →
  disputes → resolve flow against the real internal API. No reviewer
  credentials were tried since there was nothing to authenticate against.
- **Verified**: the API client module (`src/api/client.ts`) is the single
  place all internal-API calls go through, matches the endpoint contract in
  the task spec (`/api/internal/auth/login`, `/api/internal/review-queue`,
  `/api/internal/review-queue/:id/approve`, `/api/internal/review-queue/:id/reject`,
  `/api/internal/disputes`, `/api/internal/disputes/:id/resolve`), and is
  built against the exact shapes in `@cop/shared-types` (`tsc --noEmit`
  passes). Also verified: production build (`vite build`) succeeds, and the
  dev server starts and answers `200` on port 5175.
- **Verified via automated tests** (`npm test -w @cop/admin`, 17 tests, all
  passing) against fixture data in `src/fixtures/` matching
  `@cop/shared-types` exactly:
  - `officer_candidate` and `incident_candidate` proposals render correctly,
    including the null-source case.
  - Source reliability tier and match-confidence badges render.
  - The officer-ID input only appears (and is required) for unmatched
    `incident_candidate` items; approving an `officer_candidate` sends no
    edits.
  - Reject requires a non-empty reason before submitting.
  - A successful approve/reject/resolve removes the item from the visible
    list (optimistic-removal behavior).
  - An API error surfaces inline on the card (e.g. "approval failed: ...")
    rather than failing silently.
  - Disputes list, resolve form (status dropdown + notes), and the
    empty-state / evidence-link-present-or-absent rendering.

**When the internal API is up**: nothing in this app should need to change
to talk to it — point `VITE_API_BASE_URL` at it (or run the default
`http://localhost:4002`), log in with real reviewer credentials, and the
same code paths exercised in tests run against fixtures will run against
live data. Recommended next step once it's up: an end-to-end smoke pass
through login → approve one item → reject one item → resolve one dispute,
confirming the API's actual error-message shape matches what
`ApiError`/`ApiErrorResponse` assumes (`{error, message}`).
