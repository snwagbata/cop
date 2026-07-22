-- DESIGN.md §4, §7: review_queue
-- Nothing reaches the public-facing officers/incidents/outcomes views without
-- passing through here first. proposed_record holds the candidate record as
-- JSON until a reviewer approves it and it's written into the real tables.
CREATE TABLE review_queue (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    proposed_record   jsonb NOT NULL,
    source_id         uuid REFERENCES sources (id),
    match_confidence  text NOT NULL CHECK (match_confidence IN ('high', 'medium', 'low')),
    status            text NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'approved', 'rejected', 'needs_more_info'
                      )),
    reviewer_id       uuid REFERENCES reviewers (id),
    reviewed_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX review_queue_status_idx ON review_queue (status);
