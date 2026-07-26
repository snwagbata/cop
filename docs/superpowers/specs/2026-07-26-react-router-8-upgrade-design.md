# react-router 7 → 8 upgrade — design

## Problem

Final sub-project in the sequence (Node 22, React 19, Vite 8 all
already merged). This is the one that actually clears Dependabot alert
#21 — react-router 8.3.0+ includes the fix for `GHSA-qwww-vcr4-c8h2`.

## 1. What v8 actually removes — confirmed against react-router's own changelog

**`react-router-dom` is fully removed as a package in v8** — not
deprecated, not a compatibility shim, gone. Any import from
`"react-router-dom"` becomes a build error. Per the changelog: only
`RouterProvider` and `HydratedRouter` move to a new `"react-router/dom"`
entry point; **everything else** (`BrowserRouter`, `MemoryRouter`, `Link`,
`NavLink`, `NavLinkRenderProps`, `Routes`, `Route`, `Navigate`,
`useParams`, `useNavigate`, `useSearchParams`, `useLocation`, etc.) stays
importable from plain `"react-router"`.

This app uses neither `RouterProvider` nor `HydratedRouter` anywhere
(confirmed by grep — both apps use `BrowserRouter` directly, no data
router). **Every single `react-router-dom` import in this codebase
becomes a `react-router` import, uniformly, with no split logic needed.**

## 2. Scope — confirmed by exhaustive grep, not estimated

`grep -rl "react-router-dom" apps/web/src apps/admin/src` finds
**44 files** (app source + test files in both apps) importing from
`react-router-dom`. Every one of them just needs its import source
string changed from `"react-router-dom"` to `"react-router"` — no other
change to any of these files. `NavLinkRenderProps` (the type
`apps/admin/src/components/Layout.tsx` already imports, added in the
React 19 sub-project's CI fix) is confirmed to also be a plain
`"react-router"` export, unaffected by this move beyond the import path.

Both `apps/web/package.json` and `apps/admin/package.json` currently
declare `"react-router-dom": "^7.18.1"` as their only direct react-router
dependency (`react-router` itself is pulled in transitively today). This
becomes a direct `"react-router": "^8.3.0"` dependency instead —
`react-router-dom` is removed from `package.json` entirely, not just
left at an old version.

## 3. Other v8 requirements — already satisfied by prior sub-projects

- Node 22.22.0+ — satisfied (Node 22.23.1 installed).
- React 19.2.7+ — satisfied (React 19.2.8, from the React 19 sub-project).
- ESM-only (v8 drops CommonJS output) — both apps already consume
  `react-router` exclusively through Vite's ESM-native bundling; no
  CommonJS `require()` of `react-router` anywhere in the codebase.

## 4. Verification

Same standard as every prior sub-project in this series, with the same
lesson already applied from the React 19 sub-project's CI miss: **lint,
build, and test for both apps, not just build/test**. Additionally:

- After the import rewrite, `grep -r "react-router-dom" apps/web/src
  apps/admin/src` must return zero matches — a mechanical completeness
  check that the rewrite didn't miss a file.
- A real dev-server smoke check for both apps (not necessarily a full
  Fast-Refresh test like the Vite 8 sub-project — that already validated
  the bundler; this is about confirming routing itself still works: load
  the app, navigate between at least two routes, confirm no runtime
  routing error).

## Out of scope

- Adopting any new react-router 8 feature (this is a pure version/import
  migration, not a chance to restructure routing).
- This is the last planned sub-project in this series — after this
  lands, Dependabot alert #21 should show as resolved (verify by
  re-checking `gh api repos/snwagbata/cop/dependabot/alerts/21` after
  merge, rather than assuming).
