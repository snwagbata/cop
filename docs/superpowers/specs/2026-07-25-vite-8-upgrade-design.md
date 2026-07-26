# Vite 7 → 8 upgrade — design

## Problem

Third of the multi-part upgrade sequence (Node 22, React 19 already
landed) toward eventually landing react-router 8. `@vitejs/plugin-react`'s
latest major (`6.x`) requires Vite 8 — this sub-project does both
together, since they're tightly coupled and there's no reason to stage
them separately.

**This is a bigger architectural change than the prior two sub-projects,
not just a version bump**: Vite 8 replaces its dual esbuild (dev) +
Rollup (production) bundler pipeline with a single Rust-based bundler,
Rolldown. Config keys are renamed (`build.rollupOptions` →
`build.rolldownOptions`, `worker.rollupOptions` →
`worker.rolldownOptions`), and plugin authors may need changes for
content-type conversion hooks.

## 1. Codebase survey — confirmed minimal exposure to the risky parts

Read both `apps/web/vite.config.ts` and `apps/admin/vite.config.ts` in
full. Both are minimal: one plugin (`@vitejs/plugin-react`), `server`/
`preview` port config only. Grepped the whole repo for `rollupOptions`/
`rolldownOptions` — zero matches anywhere. Neither config does anything
Vite 8's renamed/changed surface touches.

`vitest@4.1.10` (already the latest, already installed) already declares
`peerDependencies.vite: "^6.0.0 || ^7.0.0 || ^8.0.0"` — no `vitest` version
bump needed at all; it already supports Vite 8 today.

**Practical read**: for this specific codebase's actual (minimal) Vite
usage, the "new bundler under the hood" risk is much lower than the
general framing suggests — there's no custom build config to migrate.
The real risk surface is narrower: does the dev server / build / preview
still work correctly end-to-end, and does `@vitejs/plugin-react@6.x`'s
Fast Refresh / JSX transform still behave the same for React 19 function
components (already confirmed to have no `forwardRef`/legacy patterns per
the React 19 sub-project's own survey).

## 2. Versions

Both `apps/web/package.json` and `apps/admin/package.json`:

| Package | Current | New |
|---|---|---|
| `vite` | `^7.3.6` | `^8.1.5` |
| `@vitejs/plugin-react` | `^4.7.0` | `^6.0.4` |

`vitest` stays at `^4.1.10` (already compatible, per §1).

## 3. Verification

Same standard as the prior two sub-projects — real local verification
under the actual new versions (Node 22 + React 19 already active
locally), not just trusted to CI. **Explicitly including `npm run lint`
this time** (`tsc --noEmit` for both apps) — the React 19 sub-project's
plan omitted this from its verification steps and a real regression
(a `NavLink` callback losing type inference under the new `@types/react`
version) reached CI instead of being caught locally, requiring a
follow-up fix commit. Every future sub-project's plan in this series
must run `lint`, `build`, and `test` for both frontends, not just
`build`/`test`.

Additionally: actually start each dev server (`npm run --workspace
apps/web dev` / `apps/admin dev`) and confirm the app loads in a real
browser with working Fast Refresh (edit a file, confirm hot-reload still
works) — Vite 8's bundler swap is exactly the kind of change where "the
test suite passes" doesn't fully cover "the dev experience still works,"
since jsdom-based unit tests don't exercise the actual dev server/HMR
pipeline at all.

## Out of scope

- react-router 7→8 (separate, next and final sub-project in this
  series — needs Node 22, React 19, and this Vite 8 upgrade all landed
  first).
- Any further Vite 8 feature adoption (e.g. opting into `rolldown-vite`
  ahead of it becoming the default, using new Rolldown-specific options)
  — this sub-project is strictly "upgrade to the version, keep behavior
  identical," not an opportunity to adopt new Vite 8 capabilities this
  project doesn't need yet.
