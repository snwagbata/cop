# Database

Raw SQL migrations implementing the schema in `DESIGN.md` §4 (currently v0.4).
No ORM/app framework yet — this is Phase 1 scope (schema + seed data) from
`DESIGN.md` §11.

## Local setup

```
docker compose up -d          # starts Postgres on localhost:5432
./db/migrate.sh                # applies db/migrations/*.sql in order
./db/seed.sh                   # loads synthetic sample data from db/seed/
```

`DATABASE_URL` defaults to `postgres://cop:cop_dev_only@localhost:5432/cop`
(matching `docker-compose.yml`); override it to point at a different Postgres
instance.

## Layout

- `migrations/` — one file per table/view, numbered in dependency order.
  Idempotent re-runs are **not** supported (no migration-tracking table yet);
  each file assumes it's running against a database that hasn't seen it
  before. Fine for this stage — revisit if/when a real migration tool
  (Alembic, sqlx, etc.) gets adopted alongside an app framework.
- `seed/` — synthetic, clearly-fictional sample data (see the header comment
  in `0001_synthetic_sample_data.sql`) used to validate the schema end-to-end:
  a multi-officer incident, a "wandering officer" spanning two departments
  with different badge numbers, an outcome cited independently of its parent
  incident, a review-queue candidate, a dispute, and revision-log entries.
  **Not a template for real data** — real records only ever enter the public
  schema through the `review_queue` → reviewer-approval flow (`DESIGN.md`
  §7), never a direct insert.

## Notable schema decisions worth knowing before touching this

- `officer_department_history` has a GiST exclusion constraint preventing two
  rows for the same `(department_id, badge_number)` from having overlapping
  active date ranges — this is what stops silent badge-reuse collisions.
- `citations` and `record_revisions` both have a polymorphic target
  (`citable_type`/`citable_id`, `record_type`/`record_id`) that Postgres
  can't enforce with a real foreign key. That's deliberate — see the comments
  in `migrations/0009_citations.sql` and `migrations/0011_record_revisions.sql`.
  Any application code writing to these tables must keep referential
  integrity itself.
- `department_stats` is a materialized view, not a table — there's no insert
  path into it. Refresh with `REFRESH MATERIALIZED VIEW CONCURRENTLY
  department_stats;` (requires the unique index already created in
  `0013_department_stats.sql`).
