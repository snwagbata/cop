-- DESIGN.md §3, §4: record_revisions
-- record_id is a polymorphic reference across four tables (officer / incident
-- / outcome / source), deliberately: Postgres cannot enforce this with a real
-- foreign key. This is an accepted trade-off for one unified audit log
-- instead of four parallel per-entity revision tables; integrity is enforced
-- at the application layer (every write path that touches those four tables
-- goes through one write function that also inserts the revision row in the
-- same transaction).
--
-- LEGAL NOTE (DESIGN.md §3): this table is the primary evidentiary record for
-- defeating an actual-malice claim under NYT v. Sullivan when an officer-
-- plaintiff is a public official — it demonstrates a systematic, non-reckless
-- review process. Treat schema changes here as touching a legal control, not
-- just an engineering convenience.
CREATE TABLE record_revisions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_type  text NOT NULL CHECK (record_type IN ('officer', 'incident', 'outcome', 'source')),
    record_id    uuid NOT NULL,
    change_type  text NOT NULL CHECK (change_type IN (
                     'create', 'update', 'approve', 'reject', 'dispute_resolution'
                 )),
    diff         jsonb,
    changed_by   uuid REFERENCES reviewers (id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX record_revisions_record_idx ON record_revisions (record_type, record_id);
