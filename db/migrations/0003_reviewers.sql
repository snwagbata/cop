-- DESIGN.md §4: reviewers
-- Created before officers/incidents/etc. since record_revisions, review_queue,
-- and disputes all reference reviewers(id).
CREATE TABLE reviewers (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name      text NOT NULL,
    email     text NOT NULL UNIQUE,
    role      text NOT NULL CHECK (role IN ('admin', 'reviewer')),
    added_at  timestamptz NOT NULL DEFAULT now(),
    active    boolean NOT NULL DEFAULT true
);
