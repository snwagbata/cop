-- DESIGN.md §3, §4, §10: disputes
-- Backs the correction/takedown process. Exactly one of incident_id /
-- outcome_id / officer_id is set per dispute — officer_id covers officer-
-- level corrections (wrong badge/department/photo) that aren't tied to any
-- single incident or outcome record.
CREATE TABLE disputes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id       uuid REFERENCES incidents (id),
    outcome_id        uuid REFERENCES outcomes (id),
    officer_id        uuid REFERENCES officers (id),
    requester_name    text NOT NULL,
    requester_role    text NOT NULL CHECK (requester_role IN (
                          'officer', 'department', 'attorney', 'subject', 'other'
                      )),
    claim             text NOT NULL,
    evidence_url      text,
    submitted_at      timestamptz NOT NULL DEFAULT now(),
    status            text NOT NULL DEFAULT 'open' CHECK (status IN (
                          'open', 'resolved_corrected', 'resolved_no_change', 'resolved_removed'
                      )),
    resolution_notes  text,
    resolved_by       uuid REFERENCES reviewers (id),
    resolved_at       timestamptz,
    CONSTRAINT disputes_exactly_one_target CHECK (
        (CASE WHEN incident_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN outcome_id  IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN officer_id  IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE INDEX disputes_status_idx ON disputes (status);
