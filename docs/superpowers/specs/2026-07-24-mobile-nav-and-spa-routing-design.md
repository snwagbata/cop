# Mobile nav + SPA routing fix — design

## Problem

Direct navigation to any non-root path on either deployed static site (e.g.
`https://cop-web-2akq.onrender.com/disputes/new`) returns a 404. Root cause:
`render.yaml`'s two `env: static` services (`cop-web`, `cop-admin`) have no
`routes:` rewrite rule, so Render's CDN 404s any path that isn't a literal
file on disk before React Router ever loads — `/disputes/new` is already a
valid route in `apps/web`'s router (`App.tsx`), it just never gets a chance
to render.

Separately: there are currently zero width-based breakpoints anywhere in
this codebase (`packages/design-system/tokens.css`,
`packages/design-system/base.css`, `apps/web/src/styles/index.css`,
`apps/admin/src/styles.css`). The nav (`apps/web/src/components/Layout.tsx`,
`apps/admin/src/components/Layout.tsx`) just wraps its links onto new lines
on narrow screens via `flex-wrap`, which is not a real mobile nav pattern.
Going forward, all UI work in this project needs to be mobile-friendly, not
just desktop — this is now a standing rule, not a one-off ask.

## Scope

- Both `apps/web` and `apps/admin` get the Render rewrite fix and a
  mobile-friendly nav.
- `apps/admin` keeps its existing behavior otherwise: no footer, catch-all
  route still redirects to `/` rather than showing a "not found" page
  (it's an internal, auth-gated tool — that's an intentional, separate
  decision from the public site's needs).
- A full mobile-viewport pass across every existing page in both apps,
  fixing real problems found (not just the nav).

## 1. Render SPA rewrite

Add to both the `cop-web` and `cop-admin` service blocks in `render.yaml`:

```yaml
routes:
  - type: rewrite
    source: /*
    destination: /index.html
```

This is the actual fix for the reported bug. Everything below is the
mobile-friendliness work layered on top.

## 2. Mobile nav — hamburger pattern

New convention: **768px** is this codebase's mobile breakpoint (first one
introduced). Below that width:

- `apps/web/src/components/Layout.tsx` and `apps/admin/src/components/Layout.tsx`
  each get a hamburger toggle `<button>` in the header, hidden above the
  breakpoint via CSS (`display: none` inside a `@media (min-width: 768px)`
  rule on the button, or the inverse — implementation detail for the plan).
- The existing `<nav aria-label="Primary">` links panel is hidden below the
  breakpoint unless the menu is open; always visible at/above it.
- State: local `useState` in each `Layout` component (`mobileMenuOpen`), no
  new dependency (no router-based state, no external menu library — this is
  a small, self-contained toggle).
- Accessibility: `aria-expanded={mobileMenuOpen}` and `aria-controls` on the
  toggle button pointing at the nav panel's `id`; button gets an
  `aria-label` (e.g. "Toggle navigation") since it's icon-only.
- Styling stays in the existing plain-CSS layering (`tokens.css` →
  `base.css` → app-local stylesheet) — the shared `.top-nav`/`.top-nav-links`
  base classes in `packages/design-system/base.css` gain the breakpoint
  behavior since both apps use them; each app's local stylesheet only adds
  what's app-specific, matching the existing "never redefine a token, only
  add layout" convention already documented in `apps/web/src/styles/index.css`.
- `apps/web/src/components/__tests__/Layout.test.tsx` gets updated for the
  new markup (toggle button present, `aria-expanded` toggles on click,
  links panel visibility reflects state). `apps/admin` gets an equivalent
  `Layout` test if one doesn't already exist.

## 3. Full mobile-viewport pass on existing pages

Zero breakpoints existing until now means page content was never checked at
narrow widths. Run each app's dev server, check every existing page at a
mobile viewport (~375–390px width) in an actual browser, and fix real
problems found. Pages in scope:

- `apps/web`: `SearchPage`, `OfficerDetailPage`, `DepartmentsListPage`,
  `DepartmentStatsPage`, `OfficersBrowsePage`, `DisputeFormPage`,
  `DisputeStatusPage`, `TipSubmissionPage`, `AboutPage`, `NotFoundPage`.
- `apps/admin`: whatever pages exist under its routes (review queue,
  officer/department detail/edit, ingestion runs, audit log, login) — exact
  list to be confirmed against `apps/admin/src/App.tsx` during
  implementation.

Most likely fix categories, to be confirmed per page during implementation:
data tables needing a horizontal-scroll wrapper instead of overflowing the
viewport, multi-column forms that need to stack to one column below the
breakpoint, and any fixed-width elements that don't shrink.

## Testing

- Existing test suites (both apps) stay green.
- New/updated component tests for the hamburger toggle (`Layout.test.tsx`
  in both apps).
- Visual verification in an actual browser at a mobile viewport for every
  page listed above, before calling this done — not just a code read-through.
- Confirm the Render rewrite syntax is correct against Render's documented
  `routes:` schema before considering that part done (this environment has
  no Render credentials to deploy-test it directly, same constraint noted
  in `DEPLOYMENT.md`).

## Out of scope

- Adding a footer or a real "not found" page to `apps/admin` (explicit
  decision — it stays as-is beyond the rewrite fix and nav).
- Any new CSS framework/breakpoint system beyond the single 768px
  convention introduced here.
