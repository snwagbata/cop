-- DESIGN.md §4: citations
-- Replaces an earlier design that FK'd sources directly to a single incident,
-- which left outcomes (settlement amounts, DA declinations — the most legally
-- sensitive figures in the schema) with no way to carry their own citation.
-- citable_id is polymorphic (incident / outcome / officer) and therefore
-- cannot carry a real foreign key across three different target tables;
-- referential integrity for citable_id is enforced at the application layer,
-- the same accepted trade-off as record_revisions.record_id (see 0011).
CREATE TABLE citations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id     uuid NOT NULL REFERENCES sources (id),
    citable_type  text NOT NULL CHECK (citable_type IN ('incident', 'outcome', 'officer')),
    citable_id    uuid NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX citations_source_idx ON citations (source_id);
CREATE INDEX citations_citable_idx ON citations (citable_type, citable_id);
