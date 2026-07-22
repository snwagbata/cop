# @cop/api-internal

Internal/admin API for the COP review-queue and dispute-resolution workflows
(DESIGN.md §7, §10). Node + TypeScript + Express, raw parameterized SQL via
`pg` (no ORM, matching the rest of this repo). Connects to Postgres as the
`cop_internal_api` role, which has SELECT/INSERT/UPDATE (no DELETE —
corrections go through `disputes`, never row deletion, per DESIGN.md §3/§9)
on every table, including the internal-only `review_queue`, `reviewers`,
`reviewer_sessions`, `record_revisions`, and `disputes` tables that the
public API role cannot see at all.

This service is **not** meant to be reachable from outside the reviewer
group — see DESIGN.md §3's "legal entity and insurance" prerequisite and
§8's internal/public separation.

## Setup

From the repo root:

```
npm install
npm run build --workspace=@cop/shared-types   # this app imports the compiled dist
```

Postgres must already be running and migrated/seeded per `db/README.md`
(`docker compose up -d && ./db/migrate.sh && ./db/seed.sh` — do **not**
re-run `seed.sh` if it's already been run once; fixed UUIDs make reruns
error, which is expected).

Then, from `apps/api-internal`:

```
npm run dev      # tsx watch, for local development
# or
npm run build && npm run start   # compiled run
```

The server listens on port `4002` by default.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://cop_internal_api:cop_internal_dev_only@localhost:5432/cop` | Postgres connection string. Must be a role with SELECT/INSERT/UPDATE on the internal tables (see `db/migrations/0015_db_roles_and_grants.sql`). |
| `PORT` | `4002` | HTTP port. |
| `CORS_ORIGIN` | `http://localhost:5175` | Allowed CORS origin (the admin frontend). |

## Bootstrapping a reviewer login

The seed data (`db/seed/0001_synthetic_sample_data.sql`) inserts a reviewer
row for `reviewer@example.org` with `password_hash = NULL` — nobody can log
in as that reviewer until a password is set. Do that with the bootstrap
script, which hashes a password with `bcryptjs` and **upserts by email**:
updates `password_hash` if a reviewer with that email already exists,
otherwise inserts a new reviewer with `role='admin'`.

```
npm run create-admin -- --email=reviewer@example.org --password=<a-real-password>
```

(`--name=<name>` is optional, used only when inserting a brand new row.)
Password must be at least 8 characters. Run this against whatever
`DATABASE_URL` the API itself will use.

## Auth model

- `POST /api/internal/auth/login` — `{ email, password }` → on success,
  `{ token, expiresAt, reviewer }`; the token is a random 32-byte hex value
  stored in `reviewer_sessions` with a 24h expiry. On failure (unknown
  email, no password set yet, or wrong password), `401` with the shared
  `ApiErrorResponse` shape — the response is deliberately identical across
  all three failure cases so login doesn't leak which one occurred.
- Every other `/api/internal/*` route requires `Authorization: Bearer
  <token>`. The token is checked against `reviewer_sessions` (must exist,
  `expires_at > now()`, and the owning reviewer must be `active`); the
  resolved reviewer is attached to `req.reviewer` and used as
  `changed_by`/`reviewer_id` in every write below.

## Endpoints

- `GET /api/internal/review-queue?status=pending` — `ListReviewQueueResponse`,
  each item's `source` joined in from `sources`.
- `POST /api/internal/review-queue/:id/approve` — body:
  `ApproveReviewQueueItemRequest` (`{ edits? }`). Dispatches on
  `proposed_record.type`:
  - `officer_candidate` — resolves `departmentName` to a `departments.id` via
    case-insensitive exact name match; **400s with a clear message and never
    guesses** if there's no match. `employment_status` defaults to `'active'`
    unless `edits.employmentStatus` overrides it. Inserts into `officers`,
    then a `record_revisions` row (`record_type='officer'`,
    `change_type='create'`, `changed_by=<reviewer id from the bearer
    token>`, `diff` = the fields written).
  - `incident_candidate` — requires an officer to attach to:
    `proposedRecord.officerId` if present, else `edits.officerId`; **400s**
    if neither is set (DESIGN.md §6: ambiguous officer matches are never
    auto-resolved, enforced here at the API boundary). Resolves
    `departmentName` the same way as above. Inserts into `incidents`, then
    `incident_officers` (`involvement_role='primary'`), then a
    `record_revisions` row (`record_type='incident'`, `change_type='create'`).
  - Either branch runs inside one DB transaction alongside the
    `review_queue` update (`status='approved'`, `reviewer_id`,
    `reviewed_at=now()`) — either everything commits or nothing does.
  - **`edits` semantics**: the proposal JSON and `edits` are shallow-merged
    (`{ ...proposedRecord, ...edits }`) before any field is read, so a
    reviewer can supply or correct any field the extraction pipeline got
    wrong or never populated — see "Known shared-types/seed-data mismatch"
    below for why this matters in practice.
- `POST /api/internal/review-queue/:id/reject` — body:
  `RejectReviewQueueItemRequest` (`{ reason }`). Sets `status='rejected'`,
  `reviewer_id`, `reviewed_at=now()`. **No `record_revisions` row is
  written** — that table's `record_type` enum only covers
  officer/incident/outcome/source, and nothing was actually published, so
  there's no real record to attach a revision to (matches the task spec).
  There's also no dedicated "rejection reason" column on `review_queue`
  (see `db/migrations/0010_review_queue.sql`), so the reason is folded back
  into `proposed_record` under a `rejectionReason` key
  (`proposed_record = proposed_record || {"rejectionReason": ...}`) so it
  stays queryable without a schema migration.
- `GET /api/internal/disputes?status=open` — `ListDisputesResponse`.
- `POST /api/internal/disputes/:id/resolve` — body: `ResolveDisputeRequest`
  (`{ status, resolutionNotes }`, status one of `resolved_corrected` /
  `resolved_no_change` / `resolved_removed`). Sets `resolved_by`,
  `resolved_at=now()`. Does **not** touch the target incident's `status`
  field — that would need a prior-status field the schema doesn't have yet
  (same caveat as the public API's dispute-creation endpoint).

All error responses use the shared `ApiErrorResponse` shape
(`{ error, message }`) with `400` for bad/incomplete input, `401` for
missing/invalid/expired auth, and `404` for an unknown id.

## Known shared-types / seed-data mismatch (read before testing approve)

`packages/shared-types/src/index.ts`'s `IncidentCandidateProposal` expects
camelCase keys (`officerName`, `departmentName`, `incidentType`,
`shortDescription`, optional `officerId`/`date`/`note`) and a mandatory
`shortDescription`. The seeded pending `review_queue` row
(`db/seed/0001_synthetic_sample_data.sql`) predates this contract and uses:

```json
{
  "type": "incident_candidate",
  "officer_name": "R. Smith",
  "department": "Springfield Police Department (fictional)",
  "incident_type": "use_of_force",
  "note": "Name-only fuzzy match; no post_certification_id or badge_number in source text."
}
```

— snake_case (`department`, `incident_type`) instead of the contract's
`departmentName`/`incidentType`, no `officerId` (it's a low-confidence
fuzzy name match, correctly *not* auto-resolved per DESIGN.md §6), and no
`shortDescription` at all. Two consequences, both expected and both
exercised in verification below:

1. Approving this row with an **empty** `edits` body correctly 400s
   (`officer_not_resolved`) — there's no `officerId` on the proposal and
   none supplied, which is exactly DESIGN.md §6's "never auto-resolve an
   ambiguous match" rule doing its job at the API boundary.
2. To actually promote this seed row, the caller must supply the missing
   camelCase fields via `edits` (e.g. `officerId`, `departmentName`,
   `incidentType`, `shortDescription`, `date`) — the API does **not**
   silently reinterpret the seed's snake_case keys as the camelCase
   contract fields. This was a deliberate choice per the task instructions
   (do not silently reshape seed data); the `edits` merge mechanism is the
   documented way to fix up an old/misshapen proposal at approval time.
