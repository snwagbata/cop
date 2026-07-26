# react-router 7 → 8 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `react-router-dom@7.18.1` with a direct `react-router@8.3.0+` dependency in both `apps/web` and `apps/admin`, and rewrite every import that currently points at `"react-router-dom"` to point at `"react-router"` instead — the final sub-project in this series, and the one that actually closes Dependabot alert #21.

**Architecture:** `react-router-dom` is fully removed as a package in v8 (confirmed against react-router's own changelog). Only `RouterProvider`/`HydratedRouter` move to a new `"react-router/dom"` entry point in v8; this codebase uses neither (both apps use `BrowserRouter` directly, no data router) — so every one of the 44 files importing from `react-router-dom` needs exactly the same mechanical change: the import source string `"react-router-dom"` becomes `"react-router"`, nothing else in any of these files changes.

**Tech Stack:** No new dependencies — `react-router` replaces `react-router-dom` as the direct dependency; the package itself was already present transitively.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-26-react-router-8-upgrade-design.md`.
- This is a **pure import-path + dependency-declaration migration** — no routing behavior, component structure, or logic changes anywhere. If a file needs any change beyond its import statement's source string, stop and treat that as a real finding to report, not something to silently paper over.
- Verification **must include `npm run lint` for both apps**, not just `build`/`test` — same lesson carried forward from the React 19 sub-project's CI miss.
- After the rewrite, `grep -rn "react-router-dom" apps/web/src apps/admin/src` must return zero matches, anywhere, including test files and comments that mention the package name in prose (a code comment referencing "react-router-dom" as a concept/history note is fine and doesn't need to change — only actual `from "react-router-dom"` import statements are in scope).
- Node 22.22.0+, React 19.2.7+ are already satisfied by prior sub-projects in this series — do not re-verify those, just confirm this upgrade doesn't regress them (same "check nothing else drifted" discipline as every prior sub-project's review).

---

### Task 1: Swap the dependency, rewrite every import, verify

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/admin/package.json`
- Modify (import statement only — one line's source string in each): all 44 files listed below

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — this is the final sub-project in the series.

- [ ] **Step 1: Swap the dependency declaration in both `package.json` files**

In `apps/web/package.json`, find:

```json
    "react-router-dom": "^7.18.1"
```

Replace with:

```json
    "react-router": "^8.3.0"
```

In `apps/admin/package.json`, find:

```json
    "react-router-dom": "^7.18.1"
```

Replace with:

```json
    "react-router": "^8.3.0"
```

(Confirm the exact surrounding comma/formatting in each file matches — this is a same-position, same-line value swap within an existing `dependencies` block, not a structural change; if either file's line doesn't end in a comma because it's the last dependency listed, preserve that.)

- [ ] **Step 2: Rewrite the import source in every one of these 44 files**

In **every** file below, find any import statement whose source is `"react-router-dom"` and change only that string to `"react-router"` — the imported names on that line (whatever they are in each specific file: `Link`, `NavLink`, `type NavLinkRenderProps`, `Route`, `Routes`, `Navigate`, `useLocation`, `useParams`, `useNavigate`, `useSearchParams`, `BrowserRouter`, `MemoryRouter`, or any combination) stay exactly as they are in each file — only the source string changes. Do not reorder, split, or otherwise touch these import lines beyond that one substitution, and do not touch anything else in any of these files.

`apps/admin`:
- `apps/admin/src/App.tsx`
- `apps/admin/src/__tests__/App.test.tsx`
- `apps/admin/src/components/Breadcrumbs.tsx`
- `apps/admin/src/components/Layout.tsx`
- `apps/admin/src/components/OfficerSearchPicker.tsx`
- `apps/admin/src/components/ReviewQueueItemCard.tsx`
- `apps/admin/src/components/__tests__/Layout.test.tsx`
- `apps/admin/src/components/__tests__/OfficerSearchPicker.test.tsx`
- `apps/admin/src/components/__tests__/ReviewQueueItemCard.test.tsx`
- `apps/admin/src/main.tsx`
- `apps/admin/src/pages/DashboardPage.tsx`
- `apps/admin/src/pages/LoginPage.tsx`
- `apps/admin/src/pages/OfficerDetailPage.tsx`
- `apps/admin/src/pages/OfficersPage.tsx`
- `apps/admin/src/pages/__tests__/AuditLogPage.test.tsx`
- `apps/admin/src/pages/__tests__/DashboardPage.test.tsx`
- `apps/admin/src/pages/__tests__/DisputesPage.test.tsx`
- `apps/admin/src/pages/__tests__/IngestionRunsPage.test.tsx`
- `apps/admin/src/pages/__tests__/LoginPage.test.tsx`
- `apps/admin/src/pages/__tests__/NewRecordPage.test.tsx`
- `apps/admin/src/pages/__tests__/OfficerDetailPage.test.tsx`
- `apps/admin/src/pages/__tests__/OfficersPage.test.tsx`
- `apps/admin/src/pages/__tests__/PhotoReviewPage.test.tsx`
- `apps/admin/src/pages/__tests__/ReviewQueuePage.test.tsx`
- `apps/admin/src/pages/__tests__/ReviewersPage.test.tsx`

`apps/web`:
- `apps/web/src/App.tsx`
- `apps/web/src/components/Breadcrumbs.tsx`
- `apps/web/src/components/IncidentCard.tsx`
- `apps/web/src/components/Layout.tsx`
- `apps/web/src/components/__tests__/Layout.test.tsx`
- `apps/web/src/main.tsx`
- `apps/web/src/pages/AboutPage.tsx`
- `apps/web/src/pages/DepartmentStatsPage.tsx`
- `apps/web/src/pages/DepartmentsListPage.tsx`
- `apps/web/src/pages/DisputeFormPage.tsx`
- `apps/web/src/pages/DisputeStatusPage.tsx`
- `apps/web/src/pages/NotFoundPage.tsx`
- `apps/web/src/pages/OfficerDetailPage.tsx`
- `apps/web/src/pages/OfficersBrowsePage.tsx`
- `apps/web/src/pages/SearchPage.tsx`
- `apps/web/src/pages/__tests__/DisputeFormPage.test.tsx`
- `apps/web/src/pages/__tests__/DisputeStatusPage.test.tsx`
- `apps/web/src/pages/__tests__/OfficerDetailPage.test.tsx`
- `apps/web/src/pages/__tests__/OfficersBrowsePage.test.tsx`
- `apps/web/src/pages/__tests__/SearchPage.test.tsx`
- `apps/web/src/pages/__tests__/TipSubmissionPage.test.tsx`

A single command can do this safely and mechanically across all 44 files at once (verify the result afterward regardless of whether you use this or edit file-by-file):

```bash
grep -rl '"react-router-dom"' apps/web/src apps/admin/src | xargs sed -i 's/"react-router-dom"/"react-router"/g'
```

- [ ] **Step 3: Confirm zero remaining references**

Run:
```bash
grep -rn "react-router-dom" apps/web/src apps/admin/src
```
Expected: no output at all. If anything remains, it's either a missed import (fix it) or a prose comment mentioning the package name as a historical reference (read it — if it's genuinely just descriptive text like "migrated from react-router-dom," it's fine to leave; if it's an actual import statement, it must be fixed).

- [ ] **Step 4: Set up this shell's PATH to reach the locally-installed Node 22**

Same as every prior sub-project. In PowerShell:

```powershell
$env:NVM_HOME = "C:\Users\heale\AppData\Local\nvm"
$env:NVM_SYMLINK = "C:\nvm4w\nodejs"
$env:Path = "$env:NVM_SYMLINK;$env:NVM_HOME;$env:Path"
node --version
```

Expected: `v22.x.x`. If these exact paths don't exist on this machine, find the real ones (`$env:LOCALAPPDATA\nvm`, `NVM_SYMLINK` user env var) — don't skip real local verification.

- [ ] **Step 5: Install and run lint, build, and test for both apps**

```powershell
npm install
npm run --workspace apps/web lint
npm run --workspace apps/admin lint
npm run --workspace apps/web build
npm run --workspace apps/admin build
npm run --workspace apps/web test
npm run --workspace apps/admin test
```

Expected: `npm install` resolves `react-router@8.3.0+` as a direct dependency in both apps with no `react-router-dom` anywhere in the tree. All six commands succeed. Test counts unchanged from before this bump (`apps/web`: 75, `apps/admin`: 132). If the known Windows optional-dependency npm bug resurfaces (missing platform-specific packages after a fresh install — has happened in every prior sub-project in this series), fix with `npm install --no-save` for whichever package(s) are missing, same as before. If a full reinstall (`node_modules` + `package-lock.json` wipe) is needed the way it was in two of the three prior sub-projects, that's acceptable — confirm afterward that Node 22/React 19/Vite 8's versions from prior sub-projects are all still intact and unchanged, the same discipline every prior sub-project's review applied.

- [ ] **Step 6: Real dev-server routing smoke check for both apps**

```powershell
npm run --workspace apps/web dev
```
In a separate terminal:
```powershell
npm run --workspace apps/admin dev
```

For `apps/web`: open the local URL, confirm the search page loads, then navigate to `/about` and back to `/` using the nav links — confirm both navigations work with no runtime error (check the browser console). For `apps/admin`: open the local URL, confirm the login page loads (a fresh unauthenticated visit should land there or redirect there), and confirm no runtime routing error appears. Stop both dev servers when done.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/admin/package.json package-lock.json apps/web/src apps/admin/src
git commit -m "Upgrade react-router 7 -> 8, closing Dependabot alert #21

Final sub-project in this series (Node 22, React 19, Vite 8 all
already landed). react-router-dom is fully removed as a package in v8
-- confirmed against react-router's own changelog that only
RouterProvider/HydratedRouter move to react-router/dom, and this
codebase uses neither (BrowserRouter only, no data router). Every one
of the 44 files importing from react-router-dom had its import source
changed to react-router, uniformly -- no other change to any of them.
react-router-dom removed from both package.json files entirely,
replaced with a direct react-router@^8.3.0 dependency.

Verified locally under real Node 22 + React 19 + Vite 8 (all from
prior sub-projects in this series): lint, build, and test pass for
both apps with unchanged counts (web 75, admin 132); zero remaining
react-router-dom references anywhere in either app's source; real
dev-server routing smoke check confirms navigation still works for
both apps."
```

- [ ] **Step 8: Confirm the Dependabot alert actually closes**

This can only be checked after the resulting PR merges to `main` (Dependabot re-scans `main`, not feature branches) — note this as a follow-up rather than something to verify in this task. After merge:
```bash
gh api repos/snwagbata/cop/dependabot/alerts/21 --jq '.state'
```
Expected, eventually (may take a short while for Dependabot to re-scan): `"fixed"` or `"dismissed"` rather than `"open"`. If it's still `"open"` after a reasonable wait post-merge, that's worth investigating rather than assuming the upgrade didn't work — Dependabot's re-scan timing is outside this repo's control.
