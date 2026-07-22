-- DESIGN.md §4, §6: officers
-- post_certification_id is the primary cross-department identity match key
-- (state POST/certification number) — badge numbers alone are too weak for
-- cross-department "wandering officer" matching since they're department-local
-- and get reused. photo_url must trace to an officially-sourced photo; a review
-- gate (not a DB constraint, since it requires human judgment — see §7) blocks
-- auto-approval of photos even from tier1 sources.
CREATE TABLE officers (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name            text NOT NULL,
    last_name             text NOT NULL,
    known_aliases         text[] NOT NULL DEFAULT '{}',
    department_id         uuid REFERENCES departments (id),   -- current department
    badge_number          text,
    rank                  text,
    hire_date             date,
    employment_status     text NOT NULL CHECK (employment_status IN (
                              'active', 'inactive', 'terminated',
                              'resigned', 'retired', 'decertified'
                          )),
    post_certification_id text,
    photo_url             text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Primary cross-department match key (§6). Not UNIQUE: nullable, and a source
-- error could otherwise block a legitimate new-officer insert; uniqueness is
-- enforced by the entity-matching/review workflow, not the DB, since a
-- collision needs human adjudication (§6's conflict rule), not a hard reject.
CREATE INDEX officers_post_certification_id_idx ON officers (post_certification_id)
    WHERE post_certification_id IS NOT NULL;

CREATE INDEX officers_department_badge_idx ON officers (department_id, badge_number);

-- Fuzzy name matching support (§6, Jaro-Winkler/pg_trgm) — always surfaced as
-- a suggestion for review, never used to auto-merge.
CREATE INDEX officers_name_trgm_idx ON officers
    USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
