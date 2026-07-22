-- DESIGN.md §4: departments
CREATE TABLE departments (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        text NOT NULL,
    state                       text NOT NULL,          -- 2-letter state code
    jurisdiction_type           text NOT NULL,          -- municipal / county / state / federal / other
    contact_info                text,
    records_request_portal_url  text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX departments_state_idx ON departments (state);
