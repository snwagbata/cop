# @cop/web

Public-facing web app for the COP officer accountability database
(DESIGN.md v0.4). React + TypeScript + Vite, consuming the public
read-only API at `/api/public/*`.

## Setup

From the repo root (this app is an npm workspace member):

```bash
npm install
npm run build --workspace=@cop/shared-types   # builds packages/shared-types/dist, required once
```

## Configuration

Copy `apps/web/.env.example` to `apps/web/.env.local` and adjust if the API
lives somewhere other than `http://localhost:4001`:

```bash
cp apps/web/.env.example apps/web/.env.local
```

```
VITE_API_BASE_URL=http://localhost:4001
```

If unset, the app falls back to `http://localhost:4001` (see
`src/lib/config.ts`).

## Run

```bash
npm run dev --workspace=@cop/web
```

Serves on **http://localhost:5173** (fixed port, `strictPort` in
`vite.config.ts`). Requires the public API to be running for real data;
without it, requests will fail with a visible error state (search box,
officer pages, department pages, and the dispute form all handle fetch
failures explicitly rather than hanging or crashing).

## Build / typecheck

```bash
npm run lint --workspace=@cop/web    # tsc --noEmit
npm run build --workspace=@cop/web   # tsc -b && vite build -> dist/
npm run preview --workspace=@cop/web # serve the production build on :5173
```

## Structure

- `src/lib/apiClient.ts` — the single module wrapping every call to the
  public API (`/api/public/officers/search`, `/api/public/officers/:id`,
  `/api/public/departments`, `/api/public/departments/:id/stats`,
  `POST /api/public/disputes`). All fetch calls live here; nothing else in
  the app calls `fetch` directly. Repointing the API only ever means
  changing `VITE_API_BASE_URL`.
- `src/lib/badges.ts` — the single source of truth mapping incident status
  and outcome type to one of four visual categories (`adverse` / `cleared`
  / `neutral` / `review`), used identically everywhere a status or outcome
  is rendered (DESIGN.md §3's juxtaposition-risk mitigation).
- `src/lib/format.ts` — currency/date formatting and enum-to-label text.
- `src/components/` — `Badge`, `PhotoOrPlaceholder`, `DisclaimerBlock`,
  `CitationList`, `IncidentCard`, `OutcomeCard`, `CandidateCard`, `Layout`.
- `src/pages/` — `SearchPage` (home + mandatory disambiguation),
  `OfficerDetailPage`, `DepartmentsListPage`, `DepartmentStatsPage`,
  `DisputeFormPage`, `NotFoundPage`.

## Legal/UI requirements this app implements (see DESIGN.md §2, §3, §6)

- **Mandatory disambiguation.** A search that matches more than one officer
  never navigates straight to a record — `SearchPage` always renders a
  picker (department, badge, active date range, photo-or-placeholder) and
  only loads officer detail once a specific candidate is chosen. Exactly
  one candidate skips straight to the officer page; zero candidates show an
  explicit no-results state.
- **No fabricated photos.** `photoUrl` is nullable end-to-end; when absent,
  `PhotoOrPlaceholder` renders a neutral initials placeholder, never a
  stock/generic headshot.
- **Disclaimer block.** `OfficerDetail.disclaimer` (API-supplied,
  counsel-drafted copy) is rendered verbatim near the top of the officer
  page via `DisclaimerBlock` — never re-worded, never in the footer.
- **Outcome/status prominence and color coding.** `Badge` + `badges.ts`
  ensure outcome type is always at least as visually prominent as incident
  description text, sustained findings are visually distinct from
  dismissed/unsustained/exonerated ones via a consistent badge system (not
  text alone), and alleged/pending get a third, neutral treatment.
- **No hidden filtering.** `OfficerDetailPage` renders every incident the
  API returns, in the order returned — no client-side sort/filter that
  could surface sustained findings without also surfacing dismissals for
  the same officer.
- **Citations everywhere.** Every incident and outcome renders its own
  `citations` list (source type, reliability tier, link); an explicit
  "no source citation on file" message when the API sends none, so missing
  sourcing is visible rather than silently blank.
- **Department scorecards, not ratings.** `DepartmentStatsPage` shows raw
  counts and a formatted currency total with identical styling regardless
  of value — no color-coded rating, star system, or ranking across
  departments.
- **Correction/dispute path.** `DisputeFormPage` posts to
  `POST /api/public/disputes` and is linkable from officer and incident
  pages with the relevant `officerId`/`incidentId` prefilled.
