-- INGESTION_DESIGN.md's officer-identity gap: NYC CCRB (and any future
-- department/source with its own stable per-officer id) needs a way to
-- recognize "this officer was already created from source X's row Y"
-- across separate ingestion runs, without re-creating a duplicate officer
-- every time. Generic and namespaced (e.g. "nyc_ccrb:<tax_id>"), mirroring
-- sources.external_ref's own namespacing-by-source convention (migration
-- 0019) -- deliberately not reusing post_certification_id (a *state* POST
-- decertification id, a different concept) or badge_number (a real
-- public-facing shield number reviewers see on the officer page).
--
-- No new grant needed: migration 0015's
-- `GRANT SELECT, INSERT, UPDATE ON officers, record_revisions, ... TO
-- cop_internal_api` already covers all columns of officers, including ones
-- added later via ALTER TABLE -- verified against a real cop_internal_api
-- connection by this migration's own test suite (see
-- packages/db-tests/src/tests/officer-external-ref-uniqueness.test.ts).
ALTER TABLE officers ADD COLUMN external_officer_ref text;

CREATE UNIQUE INDEX officers_external_officer_ref_idx
    ON officers (external_officer_ref)
    WHERE external_officer_ref IS NOT NULL;
