<!--
Fill in each section. Delete a section only if it's genuinely not applicable
(e.g. "Screenshots" for a pure backend/API change) — don't leave sections
blank.
-->

## Summary

<!-- What does this PR do and why? 2-4 sentences. Link any relevant DESIGN.md
section if this touches something it governs (§3 legal framework, §7 review
workflow, etc). -->

## Changes

<!-- Bullet list of what changed, grouped by surface if it spans more than
one (apps/web, apps/admin, apps/api-public, apps/api-internal, db/, etc).
Call out anything that isn't purely additive — schema changes, removed
endpoints, changed response shapes, anything a reviewer needs to know is
not backward compatible. -->

## Tests

<!-- What was added/changed, and what the actual result was — not "tests
should pass," the real numbers from actually running them locally. -->

- [ ] Ran the relevant workspace test suite(s) locally: `npm run --workspace <app> test` — paste pass/fail counts
- [ ] `npm run --workspace <app> build` and `lint` (where applicable) both clean
- [ ] CI is green on this branch (link the run, or note it's still in progress)
- [ ] For DB changes: migrations applied cleanly against a fresh database, not just the already-seeded dev one

## Screenshots

<!-- Required for any apps/web or apps/admin UI change. Before/after if it's
a change to something existing; just the new state if it's new. A quick
Playwright screenshot is fine — doesn't need to be polished. -->

## Notes for the reviewer

<!-- Anything a reviewer should specifically look at, known limitations,
follow-up work intentionally left out of scope, or — per DESIGN.md §3 — any
legal/privacy consideration this change touches (civilian data handling,
defamation-mitigation display rules, disputes/correction workflow, etc). -->
