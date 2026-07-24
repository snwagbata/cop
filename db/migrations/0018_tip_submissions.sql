-- DESIGN.md §12: "Anonymous, source-protected tip intake (no IP logging by
-- default) for the footage/tip submission form (§5)." §5's ingestion table
-- lists body cam footage releases as manual/crowdsourced, requiring a
-- submission form + human verification before linking — this migration is
-- the schema half of that backlog item. The public tip-intake endpoint
-- (POST /api/public/tips) writes a `sources` row plus a `review_queue` row
-- built as an IncidentCandidateProposal (see packages/shared-types), the
-- same pipeline every other unverified candidate record already goes
-- through — no new proposal type, no new queue.

-- 1. Allow 'tip_submission' as a source_type. Confirmed via
--    `pg_get_constraintdef` that the existing constraint is named
--    sources_source_type_check (migration 0004) — drop and recreate rather
--    than trying to ALTER a CHECK in place (Postgres has no such syntax).
ALTER TABLE sources DROP CONSTRAINT sources_source_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_source_type_check CHECK (source_type IN (
    'court_doc', 'news_article', 'public_records_response',
    'official_dataset', 'decertification_registry', 'tip_submission'
));

-- 2. sources.url was NOT NULL (migration 0004). A text-only tip (e.g. an
--    eyewitness account with no footage/document link) legitimately has
--    nothing to put there — forcing a placeholder URL would be worse than
--    allowing a null, since it'd look like a real citation link to anyone
--    reading it later. This only applies in practice to tip_submission
--    sources; every other source_type is still expected to carry a real url
--    by application-level convention (not enforced here as a CHECK, to keep
--    this migration narrowly scoped to what the tip feature needs).
ALTER TABLE sources ALTER COLUMN url DROP NOT NULL;

-- 3. cop_public_api currently has SELECT-only on `sources` and no grant at
--    all on `review_queue` (0015's comment block: that omission was
--    deliberate, because until now nothing let the public write a candidate
--    record directly). The anonymous tip form is the one deliberate
--    exception, mirroring 0016's precedent for `disputes` — the public
--    needs to be able to submit a tip without a reviewer account. Both
--    inserts happen in the same transaction in the tips route, so both
--    grants are added together here.
--
--    This repo has a documented history of forgetting exactly this kind of
--    grant (0016's own commit message: a missing INSERT grant on `disputes`
--    was caught late, after the endpoint was written but before it could
--    actually be exercised end-to-end). Verify this one by exercising
--    POST /api/public/tips against a cop_public_api-role connection, not
--    just as the superuser, before considering this migration done.
GRANT INSERT ON sources, review_queue TO cop_public_api;
