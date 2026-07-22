-- DESIGN.md §3, §4: incidents
-- short_description must be neutral, source-derived language only, and must
-- redact/genericize civilian (complainant/victim/witness) identifying details
-- by default unless the person is independently named as a party in the
-- source document itself (§3's third-party privacy rule). That's a review-
-- workflow gate (§7), not something the DB can enforce structurally.
CREATE TABLE incidents (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id      uuid NOT NULL REFERENCES departments (id),
    date               date NOT NULL,
    incident_type      text NOT NULL CHECK (incident_type IN (
                           'use_of_force', 'false_report', 'unlawful_arrest', 'other'
                       )),
    short_description  text NOT NULL,
    status             text NOT NULL DEFAULT 'pending' CHECK (status IN (
                           'alleged', 'sustained', 'unsustained',
                           'exonerated', 'pending', 'disputed'
                       )),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX incidents_department_idx ON incidents (department_id);
CREATE INDEX incidents_date_idx ON incidents (date);
CREATE INDEX incidents_status_idx ON incidents (status);

-- DESIGN.md §4: incident_officers
-- Join table — fixes the earlier design's mistake of a scalar "officer_id(s)"
-- field on incidents, which can't correctly represent multi-officer incidents.
CREATE TABLE incident_officers (
    incident_id       uuid NOT NULL REFERENCES incidents (id),
    officer_id        uuid NOT NULL REFERENCES officers (id),
    involvement_role  text NOT NULL CHECK (involvement_role IN (
                          'primary', 'witness', 'named_defendant', 'other'
                      )),
    PRIMARY KEY (incident_id, officer_id)
);

CREATE INDEX incident_officers_officer_idx ON incident_officers (officer_id);
