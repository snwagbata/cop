-- DESIGN.md §4: outcomes
-- amount is intentionally a single currency (default USD) for a US-only
-- launch; revisit if the project ever covers non-US jurisdictions.
CREATE TABLE outcomes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id   uuid NOT NULL REFERENCES incidents (id),
    outcome_type  text NOT NULL CHECK (outcome_type IN (
                      'internal_discipline', 'termination', 'DA_declination',
                      'lawsuit_settlement', 'lawsuit_dismissed',
                      'criminal_charges_officer', 'no_action'
                  )),
    date          date,
    amount_cents  bigint,
    currency      text NOT NULL DEFAULT 'USD',
    details       text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outcomes_incident_idx ON outcomes (incident_id);
CREATE INDEX outcomes_type_idx ON outcomes (outcome_type);
