# Node 20 → 22 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump the Node.js version this project targets from 20 to 22 everywhere it's specified (CI, Dockerfiles, `engines`, `@types/node`), and set up a real local Node 22 environment (via `nvm-windows`, alongside the existing Node 20) so the change can be genuinely verified locally, not just trusted to CI.

**Architecture:** Pure version-string changes across 7 files plus one new `.nvmrc` — no application code changes. First of three sequential sub-projects toward clearing Dependabot alert #21 (react-router 8 needs Node 22.22.0+ and React 19.2.7+; this plan handles Node only).

**Tech Stack:** No new dependencies — `nvm-windows` is a local dev-machine tool, not a project dependency.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-25-node-22-upgrade-design.md`.
- Zero application (`.ts`/`.tsx`) source file changes — this plan touches only CI config, Dockerfiles, `package.json` metadata, and adds one new `.nvmrc`.
- `@types/node` is corrected from the design doc's estimate of "three" files to the actual five: `apps/api-internal`, `apps/api-public`, `apps/ingestion`, `packages/db-tests`, `packages/ingestion-lib` (verified via direct grep, not the design doc's `package-lock.json`-based estimate).
- Local Node 22 goes in via `nvm-windows`, installed alongside the existing Node 20 — not a global replace of this machine's default Node.

---

### Task 1: Bump every Node-version reference, install Node 22 locally, verify

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/ingest-courtlistener.yml`
- Modify: `.github/workflows/ingest-nyc-ccrb.yml`
- Modify: `apps/api-internal/Dockerfile`
- Modify: `apps/api-public/Dockerfile`
- Modify: `package.json`
- Modify: `apps/api-internal/package.json`
- Modify: `apps/api-public/package.json`
- Modify: `apps/ingestion/package.json`
- Modify: `packages/db-tests/package.json`
- Modify: `packages/ingestion-lib/package.json`
- Create: `.nvmrc`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks in this repo depend on directly — this is a standalone infra change. (The *next* sub-project, React 18→19, depends on this having landed and CI being green on Node 22, but that's a separate future plan, not a code interface.)

- [ ] **Step 1: Bump the three GitHub Actions workflows**

In `.github/workflows/ci.yml`, there are two occurrences of:
```yaml
          node-version: 20
```
Replace **both** with:
```yaml
          node-version: 22
```

In `.github/workflows/ingest-courtlistener.yml`, find:
```yaml
          node-version: 20
```
Replace with:
```yaml
          node-version: 22
```

In `.github/workflows/ingest-nyc-ccrb.yml`, find:
```yaml
          node-version: 20
```
Replace with:
```yaml
          node-version: 22
```

- [ ] **Step 2: Bump both Dockerfiles**

In `apps/api-internal/Dockerfile`, find:
```dockerfile
FROM node:20-slim AS build
```
Replace with:
```dockerfile
FROM node:22-slim AS build
```
Find:
```dockerfile
FROM node:20-slim AS runtime
```
Replace with:
```dockerfile
FROM node:22-slim AS runtime
```

In `apps/api-public/Dockerfile`, find:
```dockerfile
FROM node:20-slim AS build
```
Replace with:
```dockerfile
FROM node:22-slim AS build
```
Find:
```dockerfile
FROM node:20-slim AS runtime
```
Replace with:
```dockerfile
FROM node:22-slim AS runtime
```

- [ ] **Step 3: Bump the root `engines` field**

In `package.json` (repo root), find:
```json
  "engines": {
    "node": ">=20"
  }
```
Replace with:
```json
  "engines": {
    "node": ">=22"
  }
```

- [ ] **Step 4: Bump `@types/node` in all five package.json files that declare it**

In each of `apps/api-internal/package.json`, `apps/api-public/package.json`, `apps/ingestion/package.json`, `packages/db-tests/package.json`, and `packages/ingestion-lib/package.json`, find:
```json
    "@types/node": "^20.14.0",
```
Replace with:
```json
    "@types/node": "^22.20.1",
```

- [ ] **Step 5: Add `.nvmrc`**

Create `.nvmrc` at the repo root with exactly:
```
22
```

- [ ] **Step 6: Install `nvm-windows` and Node 22 locally**

Run (PowerShell, since this installs a Windows package and modifies system PATH):
```powershell
winget install --id CoreyButler.NVMforWindows --silent --accept-package-agreements --accept-source-agreements
```

After install, **open a new shell** (PATH changes from the installer don't apply to the current session) and confirm:
```powershell
nvm version
```
Expected: prints an nvm-windows version number.

Then install and select Node 22:
```powershell
nvm install 22
nvm use 22
node --version
```
Expected: `node --version` prints a `v22.x.x` string.

- [ ] **Step 7: Run `npm install` and the full test/build suite under Node 22**

With Node 22 active (per Step 6), from the repo root:
```bash
npm install
```
Expected: completes without error; `package-lock.json`'s own `"node": ">=20"` metadata line updates automatically to `">=22"` as a side effect (do not hand-edit it — confirm it changed as expected after this step, don't assume).

Then run every workspace's build and test:
```bash
npm run --workspace packages/shared-types build
npm run --workspace packages/ingestion-lib build
npm run --workspace apps/web build
npm run --workspace apps/admin build
npm run --workspace apps/api-public build
npm run --workspace apps/api-internal build
npm run --workspace apps/ingestion build

npm run --workspace apps/web test
npm run --workspace apps/admin test
npm run --workspace apps/api-public test
npm run --workspace apps/api-internal test
npm run --workspace apps/ingestion test
npm run --workspace packages/db-tests test
```
Expected: every build and every test suite passes under Node 22, exactly as it did under Node 20 (no test count regressions — compare against the counts already known from this session: e.g. `apps/api-internal` 101 tests, `apps/admin` 132 tests, `apps/ingestion` 45 tests). The local Postgres (Docker container `cop-db-1`) needs to be running for the DB-backed suites (`apps/api-internal`, `apps/api-public`, `apps/ingestion`, `packages/db-tests`) — confirm with `docker ps` first if any of them fail with a connection error, rather than assuming Node 22 broke something.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/ingest-courtlistener.yml .github/workflows/ingest-nyc-ccrb.yml apps/api-internal/Dockerfile apps/api-public/Dockerfile package.json apps/api-internal/package.json apps/api-public/package.json apps/ingestion/package.json packages/db-tests/package.json packages/ingestion-lib/package.json package-lock.json .nvmrc
git commit -m "Upgrade Node 20 -> 22 (1 of 3, react-router 8 prep)

First of three sequential sub-projects toward clearing Dependabot alert
#21 -- react-router 8 (the eventual fix) requires Node 22.22.0+. Pure
version-string changes across CI/Dockerfiles/engines/@types/node, plus
a new .nvmrc; zero application code changes. Verified locally under a
real Node 22 (via nvm-windows) before this commit, not just trusted to
CI -- every workspace's build and test suite passes unchanged."
```
