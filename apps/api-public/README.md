# @cop/api-public

Public, read-only REST API for the COP (Officer Accountability Database) project.
Implements the `/api/public/*` contract defined in
`packages/shared-types/src/index.ts`, per `DESIGN.md` §8. Node + TypeScript +
Express, using the `pg` package for parameterized raw SQL — no ORM, matching
the rest of this project.

This service connects to Postgres as the `cop_public_api` role, which is
granted `SELECT` only on most tables (see
`db/migrations/0015_db_roles_and_grants.sql`), with one deliberate exception:
`db/migrations/0016_public_disputes_grant.sql` additionally grants `SELECT,
INSERT` on `disputes`, so `POST /api/public/disputes` can accept a public
correction/takedown submission — `UPDATE` on `disputes` stays internal-only
(only a reviewer can resolve one).

## Setup

From the repo root:

```
npm install
npm run build --workspace=@cop/api-public
```

Requires Postgres already running and migrated/seeded per `db/README.md`
(this app does not run migrations itself).

## Run

```
npm run dev --workspace=@cop/api-public     # tsx watch, no build step
# or
npm run build --workspace=@cop/api-public
npm run start --workspace=@cop/api-public   # runs dist/index.js
```

Default: listens on port 4001, connects to
`postgres://cop_public_api:cop_public_dev_only@localhost:5432/cop`, allows
CORS from `http://localhost:5173`.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4001` | HTTP port to listen on. |
| `DATABASE_URL` | `postgres://cop_public_api:cop_public_dev_only@localhost:5432/cop` | Postgres connection string. Should always point at a role with read-only grants (`cop_public_api`) — never point this service at `cop_internal_api` or the superuser role. |
| `PUBLIC_WEB_ORIGIN` | `http://localhost:5173` | Single allowed CORS origin (the public web app). |

## Routes

All routes return the shared `ApiErrorResponse` shape (`{ error, message }`)
on failure, with `400` for bad input and `404` for a missing officer/department.

- `GET /api/public/officers/search?q=<string>&departmentId=<optional uuid>` — disambiguation-only fields (name, department, badge, active date range, photo); DESIGN.md §2/§6 requires the frontend render a picker before showing any incident data whenever more than one candidate comes back. Matches on name via `ILIKE` + `pg_trgm` similarity (ordered by `similarity()` descending) and/or exact badge number, against the GIN trigram index from migration `0005_officers.sql`.
- `GET /api/public/officers/:id` — full officer detail: department, `departmentHistory` (the "wandering officer" timeline), `incidents` with nested `outcomes` (each outcome's own independent `citations`) and the incident's own `citations`, and `disclaimer` (the verbatim `STANDARD_OFFICER_PAGE_DISCLAIMER` from `@cop/shared-types` — not duplicated here).
- `GET /api/public/departments` — full department list.
- `GET /api/public/departments/:id/stats` — joins `departments` to the `department_stats` materialized view (migration `0013`). If the view has no row for a department (shouldn't happen post-refresh, but defensive), stats fields default to `0`.
- `POST /api/public/disputes` — public correction/takedown submission (DESIGN.md §10). Body: `{incidentId?, outcomeId?, officerId?, requesterName, requesterRole, claim, evidenceUrl?}`; exactly one of `incidentId`/`outcomeId`/`officerId` must be set — validated in the app with a `400` before it would ever hit the DB's own `disputes_exactly_one_target` CHECK constraint. Deliberately does **not** flip `incidents.status` to `'disputed'` on creation (the schema has no prior-status column to revert to later; see code comment in `src/routes/disputes.ts`). Rate-limited (see below).

## Rate limiting (dev-only)

`POST /api/public/disputes` has a minimal in-memory, fixed-window rate limiter
(`src/middleware/rateLimit.ts`, 5 requests / 10 minutes / `req.ip`, applied
because this is the one public unauthenticated write endpoint). **This is
explicitly dev-only, not production-hardened**: it's a plain in-process `Map`
that resets on restart, isn't shared across multiple instances/replicas behind
a load balancer, and keys off `req.ip`, which is easily rotated/spoofed and
unreliable behind a proxy unless `trust proxy` is configured correctly
upstream. Before any real deployment, replace with a shared/distributed
limiter (e.g. Redis-backed) or push this down to an edge/WAF layer — see
`DESIGN.md` §9 on rate limiting and anti-bulk-harvesting controls generally.

## No bulk officer roster endpoint

Per `DESIGN.md` §9, there is intentionally no "list all officers in
department X" endpoint — only single-officer search/lookup and department
*aggregate* stats (which expose counts/totals, never a roster).
