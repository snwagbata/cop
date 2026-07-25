# Node 20 → 22 upgrade — design

## Problem

First of three sequential sub-projects triggered by GitHub Dependabot alert
#21 (`GHSA-qwww-vcr4-c8h2`, react-router high-severity CSRF advisory in
unstable RSC code paths — confirmed not actually reachable in this
codebase, since neither frontend uses RSC APIs, but the user chose to do
the full upgrade path anyway rather than just dismiss the alert).
react-router 8 (the eventual fix) requires Node 22.22.0+ and React
19.2.7+. This sub-project handles Node only — React 19 and react-router 8
are separate, later specs.

Purely mechanical: version-string changes across CI/Dockerfiles/config, no
application logic changes.

## 1. Files to change

- `.github/workflows/ci.yml` — two `node-version: 20` occurrences (lines
  46, 123)
- `.github/workflows/ingest-courtlistener.yml` — `node-version: 20` (line
  35)
- `.github/workflows/ingest-nyc-ccrb.yml` — `node-version: 20` (line 36)
- `apps/api-internal/Dockerfile` — two `FROM node:20-slim` occurrences
  (build + runtime stages, lines 6, 16)
- `apps/api-public/Dockerfile` — two `FROM node:20-slim` occurrences
  (lines 7, 21)
- Root `package.json` — `"engines": {"node": ">=20"}` → `">=22"`
- `@types/node` — bump from `^20.14.0` to `^22.20.1` in every `package.json`
  that declares it (five: `apps/api-internal`, `apps/api-public`,
  `apps/ingestion`, `packages/db-tests`, `packages/ingestion-lib` — verified
  by direct grep of each `package.json`, correcting an earlier undercount
  from a `package-lock.json`-based check), for type-accuracy consistency
  with the new runtime target. Not strictly required (Node's core API
  surface is additive/stable across majors, so the old types mostly still
  typecheck), but the right thing to keep in sync rather than leave stale.
- New: `.nvmrc` at the repo root, containing `22` — doesn't exist today;
  adding it now since Node-version pinning is exactly what this
  sub-project is about, and it lets anyone (or CI, if ever configured to
  read it) select the right version with a plain `nvm use`.
- `package-lock.json`'s own `"node": ">=20"` metadata (line 15) —
  regenerates automatically from `npm install` after the `package.json`
  change; not hand-edited.

## 2. Local environment

This session's local Node is 20.11.0. Per the user's choice: install
`nvm-windows`, then Node 22 through it, rather than replacing the
machine's global Node install — keeps this scoped to what this repo
needs without changing the `node` command for anything else on the
machine. `nvm use 22` (or reading the new `.nvmrc`) selects it for this
repo's terminal sessions going forward.

## 3. Verification

With Node 22 actually active locally (not just trusted to CI, since we're
installing it locally): `npm install` clean, then `npm run build` and
`npm test` for every workspace (`apps/web`, `apps/admin`, `apps/api-public`,
`apps/api-internal`, `apps/ingestion`, `packages/shared-types`,
`packages/ingestion-lib`, `packages/db-tests`) to confirm nothing breaks
under the new runtime before pushing. This is real, not aspirational,
verification — unlike the original `DEPLOYMENT.md`/mobile-nav work earlier
this session, which had to lean on CI for anything requiring a newer Node
than was locally available.

## Out of scope

- React 18→19 (separate, next spec).
- react-router 7→8 (separate, final spec — depends on both this and the
  React 19 upgrade landing first).
- Any application code change — this sub-project touches zero `.ts`/`.tsx`
  source files.
