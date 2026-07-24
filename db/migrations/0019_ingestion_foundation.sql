-- INGESTION_DESIGN.md §2 ("Common pipeline shape" / "Schema additions this
-- requires"), rollout step 2 (§4): the two schema gaps every automated
-- ingestion pipeline needs before it can run safely and repeatably on a
-- recurring schedule. This migration ships the shared foundation only --
-- no pipeline (CourtListener, Juriscraper, news monitoring, etc.) is built
-- against it yet; that's deliberately deferred to follow-up work per the
-- design doc's rollout order.

-- 1. Dedup key so a pipeline that runs daily doesn't re-queue the same court
-- filing or registry row every single day. Nullable/unenforced for manual
-- entry and the tip-intake form (they don't have a natural external id);
-- unique only when present (the partial index), scoped per source_type so
-- two different sources can't collide on the same literal external id
-- string (e.g. a CourtListener docket id and a decertification-registry row
-- id that happen to coincide).
ALTER TABLE sources ADD COLUMN external_ref text;
CREATE UNIQUE INDEX sources_source_type_external_ref_idx
    ON sources (source_type, external_ref) WHERE external_ref IS NOT NULL;

-- 2. Per-run audit log -- required for debugging several unattended, mostly
-- unmonitored pipelines. Without this, a silently-failing scraper (a state
-- registry changes its HTML structure, an API starts 403ing) has no
-- visibility until someone notices the review queue went quiet for that
-- source. Applies to poll-based pipelines only -- push-based ones (a
-- CourtListener saved-search alert, the tip form) log per-request instead
-- of per-run, so a row here with a NULL finished_at persisting past its
-- expected schedule is itself the signal something's wrong. Backs the
-- read-only admin-app "ingestion runs" page (§5), similar to Audit Log.
CREATE TABLE ingestion_runs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type      text NOT NULL,
    started_at       timestamptz NOT NULL,
    finished_at      timestamptz,
    items_fetched    integer NOT NULL DEFAULT 0,
    items_queued     integer NOT NULL DEFAULT 0,
    items_deduped    integer NOT NULL DEFAULT 0,
    error            text
);

-- 3. Data-driven pipeline config, so "add a state registry" or "add a
-- keyword/department to watch" is an admin-app row edit, not a code change
-- + deploy. Read by the relevant pipeline script at the start of each run.
CREATE TABLE ingestion_configs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type      text NOT NULL,
    enabled          boolean NOT NULL DEFAULT true,
    config           jsonb NOT NULL,   -- shape is source_type-specific: state code + registry URL, RSS feed list, keyword list, etc.
    last_run_at      timestamptz
);

-- 4. Grants -- not spelled out in INGESTION_DESIGN.md's SQL block, but
-- required all the same: migration 0015's original
-- `GRANT SELECT, INSERT, UPDATE ON (...) TO cop_internal_api` only covers
-- tables that existed at the time it ran, and does NOT automatically extend
-- to tables created afterward. Every pipeline script in
-- INGESTION_DESIGN.md §2 connects as cop_internal_api (same role the admin
-- API uses -- "no new DB role needed") and needs to both write
-- ingestion_runs rows (start/finish a run) and read+write
-- ingestion_configs (read config at the start of a run, update
-- last_run_at). This exact kind of missing-grant mistake has already
-- bitten this project twice -- migration 0016 (disputes) and 0018's own
-- comment block (tip_submission's sources/review_queue grants), both caught
-- late, after the endpoint/table was built but before it could be
-- exercised end-to-end. Verified this time by exercising an INSERT/SELECT
-- against a real cop_internal_api-role connection (not just superuser)
-- before considering this migration done -- see packages/db-tests and
-- packages/ingestion-lib's test suites.
GRANT SELECT, INSERT, UPDATE ON ingestion_runs, ingestion_configs TO cop_internal_api;
