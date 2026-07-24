-- SYNTHETIC SEED DATA.
-- Every name, department, badge number, and incident below is a fictional
-- placeholder used only to validate the schema end-to-end (join tables, the
-- badge-reuse exclusion constraint, cross-department "wandering officer"
-- tracking, independently-sourced outcomes, disputes, and the review queue).
-- None of it refers to a real person, department, or event. Do not treat
-- this file as a template for real data without going through the actual
-- review_queue -> reviewer approval flow described in DESIGN.md §7.

BEGIN;

-- Reviewer -------------------------------------------------------------
INSERT INTO reviewers (id, name, email, role, active) VALUES
    ('00000000-0000-0000-0000-000000000021', 'Admin Reviewer', 'reviewer@example.org', 'admin', true);

-- Departments ------------------------------------------------------------
INSERT INTO departments (id, name, state, jurisdiction_type, contact_info, records_request_portal_url) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Springfield Police Department (fictional)', 'CA', 'municipal',
        'records@springfieldpd.example', 'https://springfieldpd.example/records'),
    ('00000000-0000-0000-0000-000000000002', 'Shelbyville Police Department (fictional)', 'CA', 'municipal',
        'records@shelbyvillepd.example', 'https://shelbyvillepd.example/records');

-- Sources ------------------------------------------------------------
INSERT INTO sources (id, source_type, url, publication_date, retrieved_date, reliability_tier) VALUES
    ('00000000-0000-0000-0000-000000000031', 'decertification_registry',
        'https://example.gov/ca-post/decertifications/2019', '2019-07-01', '2019-07-15', 'tier2_official_dataset'),
    ('00000000-0000-0000-0000-000000000032', 'court_doc',
        'https://www.courtlistener.com/example/settlement-order', '2023-11-10', '2023-12-01', 'tier1_primary_legal_doc'),
    ('00000000-0000-0000-0000-000000000033', 'news_article',
        'https://example-news.example/article/local-pd-investigation', '2022-06-05', '2022-06-06', 'tier3_established_news');

-- Officers ------------------------------------------------------------
-- Officer A: single-department officer, currently active at Springfield.
INSERT INTO officers (id, first_name, last_name, department_id, badge_number, rank, hire_date, employment_status, post_certification_id) VALUES
    ('00000000-0000-0000-0000-000000000011', 'Jane', 'Doe',
        '00000000-0000-0000-0000-000000000001', '101', 'Officer', '2016-04-01', 'active', 'CA-POST-000111');

-- Officer B: the "wandering officer" case — terminated from Shelbyville
-- after a sustained internal affairs finding, later hired at Springfield.
-- post_certification_id is what lets the two department_history rows below
-- resolve to the same officer even though badge numbers differ.
INSERT INTO officers (id, first_name, last_name, department_id, badge_number, rank, hire_date, employment_status, post_certification_id) VALUES
    ('00000000-0000-0000-0000-000000000012', 'Robert', 'Smith',
        '00000000-0000-0000-0000-000000000001', '303', 'Officer', '2019-06-01', 'active', 'CA-POST-000222');

-- Officer C: single-department officer, currently active at Shelbyville.
-- Also the seed's example of DESIGN.md §7's photo-confirmation gate: a
-- placeholder photo_url is set but photo_confirmed is left at its default
-- (false), so the admin app's photo-review queue has something to show,
-- and this officer's photo must NOT appear on any public API response
-- until a reviewer confirms it. The URL is an obviously-synthetic
-- placeholder image, never a real photo of a real person.
INSERT INTO officers (id, first_name, last_name, department_id, badge_number, rank, hire_date, employment_status, post_certification_id, photo_url) VALUES
    ('00000000-0000-0000-0000-000000000013', 'Maria', 'Nguyen',
        '00000000-0000-0000-0000-000000000002', '202', 'Sergeant', '2014-02-01', 'active', 'CA-POST-000333',
        'https://placehold.co/200x200?text=Officer+Photo');

-- officer_department_history ------------------------------------------
INSERT INTO officer_department_history (officer_id, department_id, badge_number, start_date, end_date, separation_reason, source_id) VALUES
    ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '101', '2016-04-01', NULL, NULL, NULL),
    ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000002', '55',  '2015-01-01', '2019-05-31',
        'terminated after sustained internal affairs investigation', '00000000-0000-0000-0000-000000000031'),
    ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '303', '2019-06-01', NULL, NULL, NULL),
    ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000002', '202', '2014-02-01', NULL, NULL, NULL);

-- Incidents ------------------------------------------------------------
-- Civilian names are deliberately absent/genericized per DESIGN.md §3's
-- third-party privacy rule ("the complainant," not a real or invented name).
INSERT INTO incidents (id, department_id, date, incident_type, short_description, status) VALUES
    ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001', '2022-05-20', 'use_of_force',
        'A complainant alleged excessive force was used during a traffic stop; the department''s internal affairs unit sustained the finding after review.',
        'sustained'),
    ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000002', '2018-11-02', 'false_report',
        'An internal affairs investigation sustained a finding that an incident report filed following an arrest contained materially false statements.',
        'sustained');

INSERT INTO incident_officers (incident_id, officer_id, involvement_role) VALUES
    ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000011', 'primary'),
    ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000012', 'primary');

-- Outcomes ------------------------------------------------------------
INSERT INTO outcomes (id, incident_id, outcome_type, date, amount_cents, currency, details) VALUES
    ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000041', 'internal_discipline',
        '2022-08-15', NULL, 'USD', 'Suspension without pay, 10 days.'),
    ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000042', 'termination',
        '2019-05-31', NULL, 'USD', 'Employment terminated following the sustained internal affairs finding.'),
    -- Settlement of a related federal civil rights suit — cited independently
    -- of the incident's own news coverage via `citations` below, demonstrating
    -- why outcomes need their own citation path (DESIGN.md §4).
    ('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000041', 'lawsuit_settlement',
        '2023-11-10', 15000000, 'USD', 'Civil settlement resolving a related federal civil rights lawsuit.');

-- Citations ------------------------------------------------------------
INSERT INTO citations (source_id, citable_type, citable_id) VALUES
    ('00000000-0000-0000-0000-000000000033', 'incident', '00000000-0000-0000-0000-000000000041'), -- news coverage of incident 1
    ('00000000-0000-0000-0000-000000000032', 'outcome',  '00000000-0000-0000-0000-000000000053'), -- settlement order, independent of incident 1's news source
    ('00000000-0000-0000-0000-000000000031', 'officer',  '00000000-0000-0000-0000-000000000012'), -- decertification registry entry for officer B
    ('00000000-0000-0000-0000-000000000031', 'incident', '00000000-0000-0000-0000-000000000042'), -- same registry entry also backs incident 2
    ('00000000-0000-0000-0000-000000000031', 'outcome',  '00000000-0000-0000-0000-000000000052'); -- and the termination outcome

-- Review queue ------------------------------------------------------------
-- A pending low-confidence candidate: a news mention that fuzzy-matches an
-- existing officer by name but doesn't carry a POST ID or badge number,
-- so per DESIGN.md §6 it's routed to manual review rather than auto-matched.
-- Shape matches IncidentCandidateProposal in packages/shared-types exactly
-- (camelCase, required shortDescription) — an earlier version of this seed
-- used ad-hoc snake_case fields predating that contract, which crashed the
-- admin UI's review-queue renderer (ReviewQueueItemCard expects
-- rec.incidentType) once verification/test data that had been masking the
-- mismatch was cleared out. officerId is deliberately omitted: that's what
-- forces the API's approve endpoint to require a reviewer-supplied edit
-- rather than auto-resolving a fuzzy name match.
INSERT INTO review_queue (proposed_record, source_id, match_confidence, status) VALUES
    (
        '{"type": "incident_candidate", "officerName": "R. Smith", "departmentName": "Springfield Police Department (fictional)", "incidentType": "use_of_force", "shortDescription": "A news report described a use-of-force allegation involving an officer matching this name at this department; officer identity not yet confirmed against badge or POST records.", "note": "Name-only fuzzy match; no post_certification_id or badge_number in source text."}'::jsonb,
        '00000000-0000-0000-0000-000000000033',
        'low',
        'pending'
    );

-- record_revisions ------------------------------------------------------------
-- Illustrative audit-trail entries for the approved records above; in the
-- real application these are written automatically in the same transaction
-- as the approving write (DESIGN.md §3, §7).
INSERT INTO record_revisions (record_type, record_id, change_type, diff, changed_by) VALUES
    ('officer', '00000000-0000-0000-0000-000000000011', 'create', '{"source": "manual seed, LLEAD-style sync"}'::jsonb, '00000000-0000-0000-0000-000000000021'),
    ('officer', '00000000-0000-0000-0000-000000000012', 'create', '{"source": "decertification registry sync"}'::jsonb, '00000000-0000-0000-0000-000000000021'),
    ('incident', '00000000-0000-0000-0000-000000000041', 'approve', '{"reliability_tier": "tier3_established_news", "match_confidence": "high"}'::jsonb, '00000000-0000-0000-0000-000000000021'),
    ('outcome', '00000000-0000-0000-0000-000000000053', 'approve', '{"reliability_tier": "tier1_primary_legal_doc"}'::jsonb, '00000000-0000-0000-0000-000000000021');

-- Disputes ------------------------------------------------------------
-- Officer-level dispute (DESIGN.md §4's disputes.officer_id addition) — an
-- open dispute contesting the characterization of a separation reason.
INSERT INTO disputes (officer_id, requester_name, requester_role, claim, status) VALUES
    ('00000000-0000-0000-0000-000000000012', 'Robert Smith (via counsel)', 'attorney',
        'Disputes the characterization of the 2019 separation as a termination; contends the record reflects a mutual resignation.',
        'open');

COMMIT;

-- Populate the department_stats materialized view now that seed data exists
-- (it was created empty by migration 0013, before any rows existed).
REFRESH MATERIALIZED VIEW department_stats;
