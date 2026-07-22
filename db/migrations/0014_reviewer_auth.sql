-- Reviewer authentication support for the internal admin/review-queue API
-- (DESIGN.md §7, §8). password_hash is nullable here — it's set by an
-- app-level bootstrap script (bcrypt), never by hand-written SQL, so a raw
-- hash never has to be pasted into a migration or seed file.
ALTER TABLE reviewers ADD COLUMN password_hash text;

CREATE TABLE reviewer_sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reviewer_id uuid NOT NULL REFERENCES reviewers (id),
    token       text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);

CREATE INDEX reviewer_sessions_token_idx ON reviewer_sessions (token);
