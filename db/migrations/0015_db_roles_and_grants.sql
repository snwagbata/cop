-- DESIGN.md §8, §9: internal/public separation enforced at the database
-- layer, not just application logic.
--
-- cop_public_api: read-only access to the tables that make up the public
-- product surface. No grants at all on review_queue, reviewers,
-- reviewer_sessions, record_revisions, or disputes — in Postgres, no GRANT
-- is a REVOKE by default, so omission is the enforcement mechanism there.
--
-- Row-level security policies were the mechanism named in the original
-- design write-up, but table-level GRANTs turn out to be sufficient given
-- how the schema actually works: nothing is ever written into the public-
-- facing tables (officers/incidents/outcomes/etc.) except via the
-- review_queue -> reviewer-approval pipeline (§5), so there is no
-- "unapproved" row ever sitting in those tables that would need row-level
-- filtering to hide from the public role. If that assumption changes later
-- (e.g. a soft-delete/unpublish state added to an otherwise-public table),
-- revisit with real RLS policies at that point.
--
-- cop_internal_api: read/write on everything, used by the admin/review-queue
-- service. DELETE is intentionally withheld even from this role — corrections
-- go through disputes/record_revisions, never row deletion (§3, §9's "no
-- silent removal" requirement).
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cop_public_api') THEN
        CREATE ROLE cop_public_api LOGIN PASSWORD 'cop_public_dev_only';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cop_internal_api') THEN
        CREATE ROLE cop_internal_api LOGIN PASSWORD 'cop_internal_dev_only';
    END IF;
END $$;

-- Dev-only passwords, matching the pattern already used for the `cop` user
-- in docker-compose.yml. Rotate/inject via secrets before this ever runs
-- against a database reachable from outside localhost.
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO cop_public_api, cop_internal_api', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO cop_public_api, cop_internal_api;

GRANT SELECT ON
    departments, officers, officer_department_history, incidents,
    incident_officers, outcomes, sources, citations, department_stats
TO cop_public_api;

GRANT SELECT, INSERT, UPDATE ON
    departments, officers, officer_department_history, incidents,
    incident_officers, outcomes, sources, citations,
    review_queue, reviewers, reviewer_sessions, record_revisions, disputes
TO cop_internal_api;

GRANT SELECT ON department_stats TO cop_internal_api;
