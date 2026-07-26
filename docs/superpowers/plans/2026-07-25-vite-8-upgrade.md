# Vite 7 → 8 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `vite` and `@vitejs/plugin-react` from 7/4 to 8/6 in both `apps/web` and `apps/admin` — third of the multi-part upgrade sequence (Node 22, React 19 already merged) toward react-router 8.

**Architecture:** Dependency-version-only change to `package.json`. A codebase survey (recorded in the design doc) confirmed zero `rollupOptions`/`rolldownOptions` usage anywhere and both `vite.config.ts` files are minimal (one plugin, dev/preview port config only) — Vite 8's renamed config keys and Rolldown-related plugin-author changes don't apply to anything in this repo. `vitest@4.1.10` already declares peer support for Vite 8; no `vitest` bump needed.

**Tech Stack:** No new dependencies — version bumps only.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-25-vite-8-upgrade-design.md`.
- Verification for this task **must include `npm run lint`** (`tsc --noEmit`) for both apps, not just `build`/`test` — the prior React 19 sub-project's plan omitted this and a real TypeScript regression reached CI undetected instead of being caught locally (fixed in a follow-up commit on that PR).
- Verification must also include actually starting each dev server and confirming the app loads with working Fast Refresh — Vite 8's bundler swap (esbuild+Rollup → Rolldown) is exactly the kind of change unit tests alone don't fully cover.
- `vitest` stays at `^4.1.10` — no bump needed or wanted here.
- react-router/react-router-dom stay at `7.18.1` — not touched in this plan.

---

### Task 1: Bump Vite + plugin-react in both frontends, verify

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/admin/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks in this repo depend on directly. (The final sub-project, react-router 7→8, depends on this having landed, but that's a separate future plan.)

- [ ] **Step 1: Bump the two dependency lines in both `package.json` files**

In **both** `apps/web/package.json` and `apps/admin/package.json`, find:

```json
    "@vitejs/plugin-react": "^4.7.0",
```

Replace with:

```json
    "@vitejs/plugin-react": "^6.0.4",
```

Then find:

```json
    "vite": "^7.3.6",
```

Replace with:

```json
    "vite": "^8.1.5",
```

- [ ] **Step 2: Set up this shell's PATH to reach the locally-installed Node 22**

Same as the prior two sub-projects. In PowerShell:

```powershell
$env:NVM_HOME = "C:\Users\heale\AppData\Local\nvm"
$env:NVM_SYMLINK = "C:\nvm4w\nodejs"
$env:Path = "$env:NVM_SYMLINK;$env:NVM_HOME;$env:Path"
node --version
```

Expected: prints a `v22.x.x` string. If these exact paths don't exist on this machine, check `Get-ChildItem "$env:LOCALAPPDATA\nvm"` and the `NVM_SYMLINK` user env var for the real ones — don't skip real local verification.

- [ ] **Step 3: Install**

```powershell
npm install
```

Expected: completes without error. If the known Windows optional-dependency npm bug resurfaces (`@rollup/rollup-win32-x64-msvc` and/or `@esbuild/win32-x64` missing — Vite 8's Rolldown-based pipeline may pull in different/additional platform-specific optional packages than before, so also watch for a similarly-shaped missing package under a `@rolldown/`-prefixed name), fix it the same way as the prior two sub-projects: `npm install --no-save` for whichever platform package(s) are missing, installed together in one call if more than one is needed. If a full reinstall (`node_modules` + `package-lock.json` wipe) turns out to be necessary the way it did in the React 19 sub-project, that's an acceptable fix — just confirm afterward (same as that sub-project's review did) that no package's major version drifted unintentionally anywhere else in the tree, and that `react-router`/`react-router-dom` are still exactly `7.18.1`.

- [ ] **Step 4: Run lint, build, and test for both apps — all three, not just build/test**

```powershell
npm run --workspace apps/web lint
npm run --workspace apps/admin lint
npm run --workspace apps/web build
npm run --workspace apps/admin build
npm run --workspace apps/web test
npm run --workspace apps/admin test
```

Expected: all six commands succeed. Test counts unchanged from before this bump (`apps/web`: 75, `apps/admin`: 132). If `lint` surfaces a new TypeScript error, read the actual error and fix it narrowly — do not skip straight to assuming it's an environment quirk without first checking whether it's a real, small type-compatibility issue the same way the React 19 sub-project's `NavLink` callback issue was.

- [ ] **Step 5: Start both dev servers and confirm real Fast Refresh**

```powershell
npm run --workspace apps/web dev
```

In a separate terminal/background process:

```powershell
npm run --workspace apps/admin dev
```

Confirm both print a local URL and no startup errors. Open `apps/web`'s URL in a real browser, confirm the page loads (e.g. the search page renders). Make a trivial, reversible edit to a component that's currently rendered (e.g. add and then remove a space in some visible text in `apps/web/src/pages/SearchPage.tsx`), save, and confirm the browser updates without a full page reload (Fast Refresh still works under Vite 8 + `@vitejs/plugin-react` 6). Repeat briefly for `apps/admin` (log in first if needed). Stop both dev servers when done.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/admin/package.json package-lock.json
git commit -m "Upgrade Vite 7 -> 8 + @vitejs/plugin-react 4 -> 6 (3 of N, react-router 8 prep)

Third sub-project toward react-router 8 (Node 22, React 19 already
landed). Codebase survey found zero rollupOptions/rolldownOptions usage
and both vite.config.ts files are minimal (one plugin, port config
only) -- Vite 8's renamed config keys and Rolldown-related
plugin-author changes don't apply here. vitest stays at 4.1.10
(already peers with Vite 8, no bump needed).

Verified locally under real Node 22 + React 19 + the new Vite/plugin
versions: lint, build, and test all pass for both apps with unchanged
test counts (web 75, admin 132) -- lint included explicitly this time,
after the prior sub-project's plan omitted it and a real regression
reached CI instead. Both dev servers confirmed starting cleanly with
working Fast Refresh under the new Rolldown-based pipeline."
```
