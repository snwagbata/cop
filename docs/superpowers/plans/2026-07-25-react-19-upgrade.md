# React 18 → 19 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump React and its directly-coupled dependencies from 18 to 19 in both `apps/web` and `apps/admin` — the second of a multi-part upgrade sequence (Node 22 already merged) toward eventually landing react-router 8.

**Architecture:** Dependency-version-only change. A full codebase grep (recorded in the design doc) confirmed no application code uses any pattern React 19 removes or changes (`forwardRef`, `defaultProps`/`propTypes`, legacy `ReactDOM.render`, string refs, `React.FC`, bare `useRef()`) — both apps already use `createRoot`. `@testing-library/react` must move off `16.0.1` (it only peers with React 18) to `16.3.2`. `@vitejs/plugin-react` moves within its 4.x line to `4.7.0`, not the latest `6.x`, since `6.x` requires Vite 8 — a separate, already-planned next sub-project, not bundled into this one.

**Tech Stack:** No new dependencies — version bumps only.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-25-react-19-upgrade-design.md`.
- Zero application (`.tsx`/`.ts`) source file changes expected. If verification (Step 3) surfaces a real compile or test failure, fix it narrowly scoped to whatever actually broke — do not restructure anything beyond that.
- `react-router`/`react-router-dom` stay at `7.18.1` — not touched in this plan.
- `@vitejs/plugin-react` stays in its 4.x line (`^4.7.0`) — do not jump to `6.x` here (that requires Vite 8, a separate later step).
- Verify under the real, locally-installed Node 22 (already set up via `nvm-windows` from the prior sub-project) — this shell's PATH needs `NVM_HOME`/`NVM_SYMLINK` set to reach it; see Step 2.

---

### Task 1: Bump React + coupled dependencies in both frontends, verify

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/admin/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks in this repo depend on directly.

- [ ] **Step 1: Bump the six dependency lines in both `package.json` files**

In **both** `apps/web/package.json` and `apps/admin/package.json`, find:

```json
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
```

Replace with:

```json
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
```

Then find:

```json
    "@testing-library/react": "^16.0.1",
```

Replace with:

```json
    "@testing-library/react": "^16.3.2",
```

Then find:

```json
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
```

Replace with:

```json
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^4.7.0",
```

(These three lines are adjacent in both files' `devDependencies`, per the exact grep this plan was written against — if a file's real layout differs slightly, apply each individual line's before/after value regardless of surrounding line order.)

- [ ] **Step 2: Set up this shell's PATH to reach the locally-installed Node 22**

This machine has Node 22 installed via `nvm-windows` from the prior sub-project, but a fresh shell doesn't have it on `PATH` automatically. In PowerShell:

```powershell
$env:NVM_HOME = "C:\Users\heale\AppData\Local\nvm"
$env:NVM_SYMLINK = "C:\nvm4w\nodejs"
$env:Path = "$env:NVM_SYMLINK;$env:NVM_HOME;$env:Path"
node --version
```

Expected: prints a `v22.x.x` string. If this machine's actual install paths differ from the above (check with `Get-ChildItem "$env:LOCALAPPDATA\nvm"` and `[System.Environment]::GetEnvironmentVariable("NVM_SYMLINK","User")` if the hardcoded paths above don't exist), use the real paths instead — don't skip real local verification and fall back to trusting CI alone; that defeats the purpose of having installed Node 22 locally in the first place.

- [ ] **Step 3: Install and run the full build/test suite for both frontends**

```powershell
npm install
npm run --workspace packages/shared-types build
npm run --workspace apps/web build
npm run --workspace apps/admin build
npm run --workspace apps/web test
npm run --workspace apps/admin test
```

Expected: `npm install` completes without error (if the known Windows optional-dependency npm bug from the Node 22 sub-project's report resurfaces — `@rollup/rollup-win32-x64-msvc` or `@esbuild/win32-x64` missing — fix it the same way: `npm install --no-save` for whichever platform package(s) are missing, installed together in one call if both are needed, per that report's note about npm evicting one when installing the other separately). Both builds succeed with no new TypeScript errors. Both test suites pass with the same counts as before this change (`apps/web`: 75 tests, `apps/admin`: 132 tests) — a real regression would show up here as an actual failure, not something to infer from the version bump alone.

If a genuine compile or test failure appears that isn't explained by the known npm platform-package quirk above, read the actual error, identify the specific line/pattern it points to, and fix that narrowly (e.g., a stricter `@types/react` 19 type error on one specific component) — do not make speculative changes elsewhere.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/admin/package.json package-lock.json
git commit -m "Upgrade React 18 -> 19 (2 of N, react-router 8 prep)

Second sub-project toward react-router 8 (Node 22 already landed).
Codebase survey found no application code uses any pattern React 19
removes (no forwardRef, defaultProps/propTypes, legacy ReactDOM.render,
string refs, React.FC, or bare useRef()) -- dependency-version-only
change. @testing-library/react bumped to 16.3.2 (16.0.1 doesn't peer
with React 19 at all); @vitejs/plugin-react stays in its 4.x line
rather than jumping to 6.x, which would force an unrelated Vite 8
upgrade -- that's the next sub-project, not this one. Verified locally
under real Node 22 and real React 19: both frontends' builds and full
test suites pass with unchanged test counts (web 75, admin 132)."
```
