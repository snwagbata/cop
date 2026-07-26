# React 18 → 19 upgrade — design

## Problem

Second of three sequential sub-projects toward clearing Dependabot alert
#21 (react-router 8, the eventual fix, requires React 19.2.7+ — Node
22 already landed in a prior PR). This sub-project upgrades React itself;
react-router stays on 7.18.1 until the third and final sub-project.

## 1. Codebase survey — confirmed low application-code risk

Grepped both `apps/web/src` and `apps/admin/src` (the only two workspaces
depending on `react`/`react-dom`) for every pattern React 19 actually
removes or changes behavior for:

| Pattern checked | Found? |
|---|---|
| `ReactDOM.render` (legacy root API, removed in 19) | No — both already use `createRoot` |
| `forwardRef` | No usage anywhere |
| `defaultProps`/`propTypes` on function components (removed in 19) | No usage anywhere |
| String refs (`ref="..."`) | No usage anywhere |
| `react-dom/test-utils` imports (moved in 19) | No usage anywhere |
| `React.FC`/`: FC<...>` typing (children-prop behavior changed in `@types/react` 19) | No usage anywhere |
| Bare `useRef()` with no argument | No usage anywhere |

**No application source code changes are anticipated.** This is a
dependency-version-only change, same shape as the Node 22 sub-project —
verification (§4) is what confirms this holds, not an assumption.

## 2. Dependency versions (verified against the real npm registry, not assumed)

Both `apps/web/package.json` and `apps/admin/package.json`:

| Package | Current | New | Why this exact version |
|---|---|---|---|
| `react` | `^18.3.1` | `^19.2.8` | Latest stable. |
| `react-dom` | `^18.3.1` | `^19.2.8` | Matches `react`'s peer requirement (`^19.2.8` per its own `peerDependencies`). |
| `@types/react` | `^18.3.5` | `^19.2.17` | Latest stable matching React 19. |
| `@types/react-dom` | `^18.3.0` | `^19.2.3` | Peers with `@types/react ^19.2.0`. |
| `@testing-library/react` | `^16.0.1` | `^16.3.2` | **Required, not optional** — verified `16.0.1`'s `peerDependencies` only accept `react: ^18.0.0`; React-19 support was added at `16.1.0`. Staying on `16.0.1` would leave the test suite on an unsupported peer combination. |
| `@vitejs/plugin-react` | `^4.3.1` | `^4.7.0` | Bump within the 4.x line, **not** to the latest `6.x`. Verified: `@vitejs/plugin-react` has no React-version peer dependency at all (it's a Babel-based JSX/Fast-Refresh transform, not tied to React's runtime major) — its changelog has no "added React 19 support" entry because there was never a version gate to add. The only reason to avoid jumping straight to `6.x` is that `6.x`'s own `peerDependencies` require `vite: ^8.0.0`, and this repo is still on Vite 7 (a separate, unrelated upgrade nobody has asked for) — `4.7.0` is the latest version in the already-installed major that still declares `vite: ^7.0.0` support. |

`react-router`/`react-router-dom` stay at `7.18.1` (unchanged this round) —
confirmed their `peerDependencies` are `react: >=18` (open-ended, no upper
bound), so React 19 satisfies that requirement without any conflict
while react-router itself waits for the third sub-project.

## 3. Out of scope

- `react-router`/`react-router-dom` 7→8 (separate, final sub-project —
  needs this and the already-landed Node 22 upgrade first).
- `vite` 7→8, which `@vitejs/plugin-react`'s latest major would otherwise
  pull in — explicitly avoided (§2).
- Any application code refactor — none identified as needed (§1); if
  verification (§4) surfaces a real compile/runtime issue despite the
  survey, fix it as part of this same task, scoped narrowly to whatever
  broke, not as a redesign.

## 4. Verification

Same standard as the Node 22 sub-project: real local verification under
the actual new versions, not just trusted to CI. With Node 22 (already
set up locally via `nvm-windows`) and the new React/testing-library/
plugin versions installed, run `apps/web` and `apps/admin`'s full build
and test suites and confirm identical test counts to before (web 75,
admin 132) — a real regression would show up as a failing test or a
build/typecheck error, not something to infer from the dependency bump
alone.
