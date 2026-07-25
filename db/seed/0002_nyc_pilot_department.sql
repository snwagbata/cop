-- Real department, unlike 0001's fictional Springfield/Shelbyville rows --
-- added specifically to let the NYC CCRB ingestion pipeline
-- (INGESTION_DESIGN.md §3.2, docs/superpowers/specs/2026-07-24-nyc-ccrb-
-- ingestion-pipeline-design.md) resolve a department match. This is a
-- public entity (a city police department's existence is not sensitive
-- data), not officer data -- no real officer/incident/outcome rows are
-- seeded here or anywhere else in this repo. DEPLOYMENT.md's "don't
-- deploy real officer data" constraint is about officer-level records,
-- which this does not add.

BEGIN;

-- Fixed UUID, matching 0001_synthetic_sample_data.sql's convention (its
-- departments use ...0001/...0002) -- the next one in that same sequence.
INSERT INTO departments (id, name, state, jurisdiction_type, contact_info, records_request_portal_url) VALUES
    ('00000000-0000-0000-0000-000000000003', 'New York City Police Department', 'NY', 'municipal', NULL,
        'https://a860-openrecords.nyc.gov/');

COMMIT;
