-- DESIGN.md §4, §6: officer_department_history
-- Backs "wandering officer" tracking. The exclusion constraint prevents two
-- history rows for the same department+badge number from having overlapping
-- active date ranges, which stops silent badge-reuse collisions from ever
-- landing in the data (§6). NULL badge_number rows are exempt from the
-- exclusion check (Postgres treats NULLs as distinct for this purpose) —
-- acceptable since a badge-less history row can't collide on badge anyway.
CREATE TABLE officer_department_history (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_id         uuid NOT NULL REFERENCES officers (id),
    department_id      uuid NOT NULL REFERENCES departments (id),
    badge_number       text,
    start_date         date NOT NULL,
    end_date           date,                              -- NULL = current
    separation_reason  text,
    source_id          uuid REFERENCES sources (id),
    period             daterange GENERATED ALWAYS AS (
                           daterange(start_date, COALESCE(end_date, 'infinity'::date), '[)')
                       ) STORED,
    CONSTRAINT officer_department_history_valid_range CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT officer_department_history_no_badge_overlap EXCLUDE USING gist (
        department_id WITH =,
        badge_number WITH =,
        period WITH &&
    )
);

CREATE INDEX officer_department_history_officer_idx ON officer_department_history (officer_id);
CREATE INDEX officer_department_history_department_idx ON officer_department_history (department_id);
