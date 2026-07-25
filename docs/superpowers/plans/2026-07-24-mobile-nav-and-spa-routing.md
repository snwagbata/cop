# Mobile Nav + SPA Routing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 404-on-direct-navigation bug on both deployed static sites (missing Render SPA rewrite rule), and make both apps' nav mobile-friendly with a hamburger menu — the first responsive breakpoint in this codebase — then sweep every existing page at mobile width and fix real overflow problems found.

**Architecture:** One-line `routes:` rewrite added to both static services in `render.yaml` fixes the actual reported bug (the app's router already has a working catch-all/route set — the static host just never gave it a chance to load). Separately, a shared `768px` breakpoint and `.nav-toggle` button pattern is added to `packages/design-system/base.css` (used by both apps), with each app's `Layout.tsx` getting local `useState` to drive an `is-open` class — no new dependencies. Known CSS overflow risks (flex rows and CSS grid tracks that don't shrink/stack below 768px) get concrete fixes; the rest get a real-browser check at mobile width as the final task.

**Tech Stack:** React 18 + TypeScript, react-router-dom v7, Vite, Vitest + @testing-library/react + @testing-library/user-event, plain CSS (no framework) via `packages/design-system/tokens.css` → `base.css` → per-app stylesheet layering.

## Global Constraints

- Never redefine a color/spacing value that already has a design-system token — only add layout/structure (existing convention, stated at the top of both apps' stylesheets).
- `768px` is the one and only breakpoint this plan introduces; don't invent a second one.
- No new npm dependencies — `@testing-library/user-event` is already present in both apps' `package.json`.
- Keep `apps/admin`'s existing behavior otherwise unchanged: no footer, catch-all still redirects to `/` (confirmed out of scope per the design doc).

---

### Task 1: Fix the Render SPA rewrite (both static sites)

**Files:**
- Modify: `render.yaml`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks depend on — this is the actual bug fix, independent of the mobile-nav work below.

- [ ] **Step 1: Add the rewrite rule to `cop-web`**

In `render.yaml`, inside the `cop-web` service block (`name: cop-web`), add a `routes:` key alongside the existing `buildCommand`/`staticPublishPath`/`envVars` keys:

```yaml
  - type: web
    name: cop-web
    env: static
    buildCommand: npm ci && npm run --workspace packages/shared-types build && npm run --workspace apps/web build
    staticPublishPath: apps/web/dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
    envVars:
      - key: VITE_API_BASE_URL
        value: https://cop-api-public.onrender.com
```

- [ ] **Step 2: Add the same rewrite rule to `cop-admin`**

```yaml
  - type: web
    name: cop-admin
    env: static
    buildCommand: npm ci && npm run --workspace packages/shared-types build && npm run --workspace apps/admin build
    staticPublishPath: apps/admin/dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
    envVars:
      - key: VITE_API_BASE_URL
        value: https://cop-api-internal.onrender.com
```

- [ ] **Step 3: Verify the YAML is well-formed**

Run: `git diff render.yaml`

Confirm the two new `routes:` blocks are each indented exactly 4 spaces (same level as the sibling `envVars:`/`buildCommand:`/`staticPublishPath:` keys under that service), `- type: rewrite` is indented 6 spaces (2 more than `routes:`, matching how `- key:` is indented under `envVars:` elsewhere in this file), and `source:`/`destination:` are indented 8 spaces (2 more than `- type:`). YAML is indentation-sensitive — a mismatch here is the most likely mistake, and this file has no automated lint/parse step in this repo to catch it, so this visual check is the verification.

Expected: indentation in the diff matches the blocks shown in Steps 1–2 exactly.

- [ ] **Step 4: Commit**

```bash
git add render.yaml
git commit -m "Add Render SPA rewrite rule to both static sites

Direct navigation to any non-root path (/disputes/new, /review-queue,
etc.) 404s today because Render's CDN never falls back to index.html for
a static site by default -- the app's own router already handles these
routes correctly, it just never gets a chance to load."
```

---

### Task 2: Shared mobile-nav CSS scaffold (`packages/design-system/base.css`)

**Files:**
- Modify: `packages/design-system/base.css`

**Interfaces:**
- Consumes: nothing.
- Produces: `.nav-toggle` (hamburger button styling, hidden ≥768px) and `.nav-toggle-bar` (the three-line icon) classes; `@media (max-width: 767px)` behavior that hides `.top-nav-links` unless its ancestor `.top-nav` has class `is-open`. Tasks 3 and 4 render markup using exactly these class names.

- [ ] **Step 1: Add the breakpoint block to `base.css`**

Add this at the end of `packages/design-system/base.css` (after the existing `@media (prefers-reduced-motion: reduce)` block):

```css
/* --- mobile nav (first width-based breakpoint in this codebase; see
   docs/superpowers/specs/2026-07-24-mobile-nav-and-spa-routing-design.md) --- */

.nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  flex-shrink: 0;
}

.nav-toggle-bar {
  position: relative;
  display: block;
  width: 18px;
  height: 2px;
  background: currentColor;
}
.nav-toggle-bar::before,
.nav-toggle-bar::after {
  content: "";
  position: absolute;
  left: 0;
  width: 18px;
  height: 2px;
  background: currentColor;
}
.nav-toggle-bar::before {
  top: -6px;
}
.nav-toggle-bar::after {
  top: 6px;
}

@media (max-width: 767px) {
  .top-nav {
    flex-wrap: wrap;
  }
  .nav-toggle {
    display: inline-flex;
  }
  .top-nav-links {
    display: none;
    width: 100%;
  }
  .top-nav.is-open .top-nav-links {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }
}
```

- [ ] **Step 2: Visually sanity-check the base styles compile**

Run: `npm run --workspace apps/web build` (pulls in `@cop/design-system` — this just confirms the CSS has no syntax errors that break the Vite build; real visual verification happens in Task 6 once the markup exists to trigger these rules).

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/design-system/base.css
git commit -m "Add shared hamburger-nav CSS scaffold (768px breakpoint)

First width-based breakpoint in this codebase. Defines .nav-toggle
button styling and the @media rule that collapses .top-nav-links below
768px unless the ancestor .top-nav has class is-open. Not wired to any
markup yet -- apps/web and apps/admin Layout components do that next."
```

---

### Task 3: `apps/web` — hamburger toggle in `Layout.tsx`

**Files:**
- Modify: `apps/web/src/components/Layout.tsx`
- Modify: `apps/web/src/components/__tests__/Layout.test.tsx`

**Interfaces:**
- Consumes: `.nav-toggle`, `.nav-toggle-bar`, `.top-nav.is-open .top-nav-links` from Task 2.
- Produces: nothing other tasks depend on (apps/web and apps/admin `Layout` components are independent, per the design doc — not shared).

- [ ] **Step 1: Write the failing test**

Replace the full contents of `apps/web/src/components/__tests__/Layout.test.tsx` with:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Layout } from "../Layout";

describe("Layout", () => {
  it("renders the site nav and its children", () => {
    render(
      <MemoryRouter>
        <Layout>
          <p>page content</p>
        </Layout>
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Correction Request/ })).toBeInTheDocument();
  });

  it("has a mobile nav toggle that expands and collapses the primary nav", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Layout>
          <p>page content</p>
        </Layout>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the mobile menu after a nav link is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Layout>
          <p>page content</p>
        </Layout>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("link", { name: "Departments" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run the tests to verify the two new ones fail**

Run: `npm run --workspace apps/web test -- Layout`
Expected: FAIL — `Unable to find role="button" name "Toggle navigation"` (the button doesn't exist yet).

- [ ] **Step 3: Implement the toggle in `Layout.tsx`**

Replace the full contents of `apps/web/src/components/Layout.tsx` with:

```tsx
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export function Layout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="site-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`top-nav${mobileMenuOpen ? " is-open" : ""}`}>
        <Link className="brand" to="/">
          COP — Officer Accountability Database
        </Link>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={mobileMenuOpen}
          aria-controls="primary-nav"
          aria-label="Toggle navigation"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <span className="nav-toggle-bar" />
        </button>
        <nav
          className="top-nav-links"
          aria-label="Primary"
          id="primary-nav"
          onClick={() => setMobileMenuOpen(false)}
        >
          <Link to="/">Search</Link>
          <Link to="/departments">Departments</Link>
          <Link to="/about">About &amp; Methodology</Link>
          <Link to="/tips/new">Submit a Tip</Link>
          <Link to="/disputes/new">Correction Request</Link>
          <Link to="/disputes/status">Check Dispute Status</Link>
        </nav>
      </header>
      <main id="main" className="container">
        {children}
      </main>
      <footer className="site-footer">
        Records are sourced from public documents. See each record's citations for sources, and use the{" "}
        <Link to="/disputes/new">correction request form</Link> to dispute anything inaccurate, or{" "}
        <Link to="/disputes/status">check the status</Link> of a request you already submitted.
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run --workspace apps/web test -- Layout`
Expected: PASS (all three tests).

- [ ] **Step 5: Run the full apps/web test suite to check for regressions**

Run: `npm run --workspace apps/web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Layout.tsx apps/web/src/components/__tests__/Layout.test.tsx
git commit -m "Add mobile hamburger nav toggle to apps/web Layout

Below 768px (packages/design-system/base.css), .top-nav-links is
hidden until the new toggle button opens it via an is-open class on
the header. Menu also closes itself when a link inside it is clicked."
```

---

### Task 4: `apps/admin` — hamburger toggle in `Layout.tsx`

**Files:**
- Modify: `apps/admin/src/components/Layout.tsx`
- Modify: `apps/admin/src/styles.css`
- Create: `apps/admin/src/components/__tests__/Layout.test.tsx`

**Interfaces:**
- Consumes: `.nav-toggle`, `.nav-toggle-bar`, `.top-nav.is-open .top-nav-links` from Task 2; the `useAuth` mocking pattern already used in `apps/admin/src/pages/__tests__/DashboardPage.test.tsx` (mocks `../../context/AuthContext`'s `useAuth` export).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/components/__tests__/Layout.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Layout } from "../Layout";

vi.mock("../../context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AuthContext")>("../../context/AuthContext");
  return {
    ...actual,
    useAuth: () => ({
      reviewer: { id: "rev-1", name: "Admin Reviewer", email: "reviewer@example.org", role: "admin", active: true },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

describe("Layout", () => {
  it("renders the primary nav, reviewer info, and children", () => {
    render(
      <MemoryRouter>
        <Layout>
          <p>page content</p>
        </Layout>
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByText(/Admin Reviewer/)).toBeInTheDocument();
  });

  it("has a mobile nav toggle that expands and collapses the primary nav", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Layout>
          <p>page content</p>
        </Layout>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run --workspace apps/admin test -- Layout`
Expected: FAIL — `Unable to find role="button" name "Toggle navigation"`.

- [ ] **Step 3: Implement the toggle in `Layout.tsx`**

Replace the full contents of `apps/admin/src/components/Layout.tsx` with:

```tsx
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Layout({ children }: { children: ReactNode }) {
  const { reviewer, logout } = useAuth();
  const isAdmin = reviewer?.role === "admin";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`top-nav${mobileMenuOpen ? " is-open" : ""}`}>
        <div className="top-nav-left">
          <span className="brand">COP Admin</span>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={mobileMenuOpen}
            aria-controls="primary-nav admin-user-panel"
            aria-label="Toggle navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span className="nav-toggle-bar" />
          </button>
          <nav
            className="top-nav-links"
            aria-label="Primary"
            id="primary-nav"
            onClick={() => setMobileMenuOpen(false)}
          >
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Dashboard
            </NavLink>
            <NavLink to="/review-queue" className={({ isActive }) => (isActive ? "active" : "")}>
              Review Queue
            </NavLink>
            <NavLink to="/disputes" className={({ isActive }) => (isActive ? "active" : "")}>
              Disputes
            </NavLink>
            <NavLink to="/new-record" className={({ isActive }) => (isActive ? "active" : "")}>
              New Record
            </NavLink>
            <NavLink to="/audit-log" className={({ isActive }) => (isActive ? "active" : "")}>
              Audit Log
            </NavLink>
            <NavLink to="/photo-review" className={({ isActive }) => (isActive ? "active" : "")}>
              Photo Review
            </NavLink>
            <NavLink to="/ingestion-runs" className={({ isActive }) => (isActive ? "active" : "")}>
              Ingestion Runs
            </NavLink>
            {isAdmin && (
              <NavLink to="/reviewers" className={({ isActive }) => (isActive ? "active" : "")}>
                Reviewers
              </NavLink>
            )}
          </nav>
        </div>
        <div className="top-nav-right" id="admin-user-panel">
          {reviewer && (
            <span className="text-muted">
              {reviewer.name} ({reviewer.role})
            </span>
          )}
          <button type="button" className="btn-link" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main id="main" className="page container-wide">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Add admin-specific mobile CSS for `.top-nav-right`**

`base.css` (Task 2) only collapses `.top-nav-links` — admin also has a `.top-nav-right` block (reviewer name + logout) that needs the same treatment, and it's admin-only so it belongs in admin's own stylesheet. Add to the end of `apps/admin/src/styles.css`:

```css
/* --- mobile nav (admin's second nav group; base.css's shared rule only
   covers .top-nav-links — see packages/design-system/base.css) --- */

@media (max-width: 767px) {
  .top-nav-right {
    display: none;
    width: 100%;
  }
  .top-nav.is-open .top-nav-right {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run --workspace apps/admin test -- Layout`
Expected: PASS (all three tests).

- [ ] **Step 6: Run the full apps/admin test suite to check for regressions**

Run: `npm run --workspace apps/admin test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/components/Layout.tsx apps/admin/src/components/__tests__/Layout.test.tsx apps/admin/src/styles.css
git commit -m "Add mobile hamburger nav toggle to apps/admin Layout

Same pattern as apps/web (packages/design-system/base.css's shared
.nav-toggle/is-open rule), plus an admin-specific mobile rule for the
.top-nav-right reviewer-info/logout block base.css doesn't know about."
```

---

### Task 5: Fix known narrow-viewport CSS overflow risks

**Files:**
- Modify: `apps/web/src/styles/index.css`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent CSS fixes).
- Produces: nothing other tasks depend on.

These three are concrete, verified-in-code overflow risks found by reading the existing CSS (not speculative): a fixed-width flex row with no wrap, and a CSS grid column sized with `max-content` (which does not shrink to fit its container — it can force the whole grid, and the page, wider than the viewport).

- [ ] **Step 1: Fix `apps/web`'s `.dispute-status-form`**

In `apps/web/src/styles/index.css`, find:

```css
.dispute-status-form {
  display: flex;
  gap: var(--space-2);
  max-width: 480px;
  margin: var(--space-4) 0 var(--space-6);
  align-items: flex-end;
}
.dispute-status-form .field {
  flex: 1;
  margin-bottom: 0;
}
```

Replace with (adds `flex-wrap` so the button drops below the input field instead of forcing horizontal overflow on narrow screens, and gives `.field` a wrap-friendly basis):

```css
.dispute-status-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  max-width: 480px;
  margin: var(--space-4) 0 var(--space-6);
  align-items: flex-end;
}
.dispute-status-form .field {
  flex: 1 1 200px;
  margin-bottom: 0;
}
```

- [ ] **Step 2: Fix `apps/admin`'s `.kv-grid`**

In `apps/admin/src/styles.css`, find:

```css
.kv-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-4);
  font-size: 0.9rem;
  margin: var(--space-2) 0 var(--space-3);
}
```

Leave that rule as-is (it's correct for desktop widths, where labels like "POST/certification ID" and "Linked footage/document" have room), and add a mobile override right after it:

```css
@media (max-width: 767px) {
  .kv-grid {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }
}
```

- [ ] **Step 3: Fix `apps/admin`'s `.bulk-toolbar`**

In `apps/admin/src/styles.css`, find:

```css
.bulk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
```

Add `flex-wrap: wrap;` (the "Select all (N)" label and the "Bulk approve selected (N)" button both have variable-length text that can exceed a narrow viewport's width side-by-side):

```css
.bulk-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
```

- [ ] **Step 4: Run both apps' test suites to confirm no regressions (CSS-only change, no test logic to add)**

Run: `npm run --workspace apps/web test && npm run --workspace apps/admin test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/index.css apps/admin/src/styles.css
git commit -m "Fix known narrow-viewport overflow risks

.dispute-status-form (web) and .bulk-toolbar (admin) are flex rows with
no wrap and variable-length text/inputs that can exceed a narrow
viewport's width; .kv-grid (admin) uses a max-content grid column that
doesn't shrink to fit its container. All three get a wrap/stack fix."
```

---

### Task 6: Real-browser mobile pass across every existing page

**Files:**
- Potentially modify: any file under `apps/web/src/styles/index.css` or `apps/admin/src/styles.css` for issues found (using the same `flex-wrap` / grid-stack techniques demonstrated in Task 5 — no new patterns should be needed, but note the exact selector and fix if one is).

**Interfaces:**
- Consumes: the working hamburger nav (Tasks 3–4) and the SPA rewrite (Task 1, needed so direct-URL navigation works while checking each page).
- Produces: nothing — this is the final verification task for the whole plan.

- [ ] **Step 1: Start both dev servers**

Run (in two separate terminals/background processes):
```bash
npm run --workspace apps/web dev
npm run --workspace apps/admin dev
```
Note the local URLs Vite prints (typically `http://localhost:5173` for web, a different port for admin if run concurrently — check the terminal output).

- [ ] **Step 2: Check every `apps/web` page at a 375px-wide viewport**

Using a real browser (resize the window or use devtools' device toolbar at ~375×667, the classic small-phone size), visit each of the following and confirm: no horizontal scrollbar/overflow, the hamburger menu opens/closes and its links are all reachable and tappable, and text/buttons aren't clipped or overlapping:

- `/` (SearchPage)
- `/officers/:id` — use any seeded officer id from `db/seed/0001_synthetic_sample_data.sql` (OfficerDetailPage)
- `/departments` (DepartmentsListPage)
- `/departments/:id` (DepartmentStatsPage)
- `/departments/:id/officers` (OfficersBrowsePage)
- `/disputes/new` (DisputeFormPage)
- `/disputes/status` (DisputeStatusPage — confirms Task 5 Step 1's fix)
- `/tips/new` (TipSubmissionPage)
- `/about` (AboutPage)
- `/this-path-does-not-exist` (NotFoundPage — confirms it still renders nav+footer)

If a problem is found that Task 5 doesn't already cover, fix it in `apps/web/src/styles/index.css` using the same technique (add `flex-wrap: wrap` to the offending flex row, or a `@media (max-width: 767px)` override for a grid/fixed-width element), then re-check that specific page.

- [ ] **Step 3: Check every `apps/admin` page at a 375px-wide viewport**

Log in with a local admin account (see `apps/api-internal`'s `create-admin` script / `DEPLOYMENT.md` step 5 for the command, or use whatever local seed reviewer credentials already exist in this dev environment), then check:

- `/login` (LoginPage)
- `/` (DashboardPage)
- `/review-queue` (ReviewQueuePage — confirms Task 5 Step 3's `.bulk-toolbar` fix, and the `.kv-grid` fix inside `ReviewQueueItemCard`)
- `/disputes` (DisputesPage)
- `/new-record` (NewRecordPage)
- `/audit-log` (AuditLogPage — table already wrapped in `.table-scroll`, confirm it actually scrolls horizontally rather than breaking the page layout)
- `/photo-review` (PhotoReviewPage — confirms `.kv-grid` fix inside `PhotoReviewCard`)
- `/ingestion-runs` (IngestionRunsPage — table already wrapped in `.table-scroll`)
- `/reviewers` (ReviewersPage, admin-role account only — table already wrapped in `.table-scroll`)
- `/some-bad-path` (confirms the existing redirect-to-`/` catch-all still works — no page to check visually here, just confirm it redirects instead of erroring)

Same fix-and-recheck loop as Step 2 for anything found.

- [ ] **Step 4: Run both full test suites one final time**

Run: `npm run --workspace apps/web test && npm run --workspace apps/admin test`
Expected: PASS.

- [ ] **Step 5: Commit any fixes found during the pass**

Only if Step 2 or 3 required changes beyond Task 5's:

```bash
git add apps/web/src/styles/index.css apps/admin/src/styles.css
git commit -m "Fix additional mobile-viewport issues found during page-by-page review"
```

If no additional issues were found, skip this commit — Task 5 already covered everything, and this task is confirmation, not new work.
