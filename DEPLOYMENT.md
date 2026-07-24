# Deploying COP (demo/preview only)

**Read this before deploying anything.** This covers getting the current
build — running entirely on synthetic, fictional seed data — onto a public
URL for preview purposes. It does **not** cover real public launch: per
`DESIGN.md` §3, that needs a legal entity, insurance, and First Amendment
counsel review first, none of which has happened. Don't put real officer
data into whatever you deploy from this doc.

**Honesty check on this doc itself**: this environment still has no
hosting-platform credentials of its own, but this Blueprint *has* since been
deployed for real (by the project owner, on their own Render account) and
checked against the live services over plain HTTP from this environment —
`cop-api-public`, `cop-api-internal`, and `cop-admin` all confirmed healthy
and serving real seeded data. That check is also what surfaced §4b's
CORS/hostname-collision issue (`cop-web` deployed under a suffixed
hostname, breaking `PUBLIC_WEB_ORIGIN`) — now documented and fixed in
`render.yaml`, rather than a remaining unknown. What's still unverified from
this environment specifically: the Dockerfiles' own build process on
Render's build infrastructure (only the resulting running containers were
checked, not a build-from-scratch), and static-site build commands running
on Render's infra rather than locally. If something in here doesn't match
what you see in the Render dashboard, that's the gap — tell me and I'll fix
it.

## Recommended path: Render (free tier)

Render was chosen over Railway/Fly/Vercel because it has a durable free
tier for exactly this shape of app (small web services + a Postgres
instance + static sites) and a declarative Blueprint (`render.yaml`,
already in this repo) that provisions all five pieces from one dashboard
action — no CLI, no local Docker needed on your end either.

### 1. Create the Blueprint

Render dashboard → **New** → **Blueprint** → connect this repo, branch
`main`. Render reads `render.yaml` and proposes: a Postgres database (`cop-db`), two
Docker-built web services (`cop-api-public`, `cop-api-internal`), and two
static sites (`cop-web`, `cop-admin`). Approve it. The two API services
will fail to start after this step — expected, they don't have a working
`DATABASE_URL` yet (that's step 3).

### 2. Get the database's connection info

Render dashboard → `cop-db` → **Connect** → copy the **External Connection
String**. It looks like:

```
postgres://cop:<generated-password>@<host>.render.com/cop?sslmode=require
```

### 3. Run migrations + seed (one-time, from your own machine)

With `psql` installed locally and this repo checked out:

```
DATABASE_URL="postgres://cop:<password>@<host>.render.com/cop?sslmode=require" ./db/migrate.sh
DATABASE_URL="postgres://cop:<password>@<host>.render.com/cop?sslmode=require" ./db/seed.sh
```

`migrate.sh` includes migration `0015`, which creates the `cop_public_api`
and `cop_internal_api` roles with the same dev-only passwords used locally
(`cop_public_dev_only` / `cop_internal_dev_only`) — fine for a demo
instance with no real data, not something to reuse if this ever becomes a
real deployment.

### 4. Set the two DATABASE_URLs Render couldn't provision automatically

The Blueprint's `cop-api-public` and `cop-api-internal` services need
role-specific connection strings that don't exist until step 3 has run.
Using the same `<host>` from step 2:

- `cop-api-public` service → Environment → `DATABASE_URL`:
  ```
  postgres://cop_public_api:cop_public_dev_only@<host>.render.com/cop?sslmode=require
  ```
- `cop-api-internal` service → Environment → `DATABASE_URL`:
  ```
  postgres://cop_internal_api:cop_internal_dev_only@<host>.render.com/cop?sslmode=require
  ```

Saving these triggers a redeploy of each service. Once both are up, check
`https://cop-api-public.onrender.com/healthz` returns `{"ok":true}`.

### 4b. Confirm the two static sites' real hostnames, and set CORS origins to match

**Confirmed in a real deploy, not hypothetical:** if `cop-web` or `cop-admin`
is already taken somewhere else on Render's global namespace, Render
silently deploys yours under a suffixed hostname instead (e.g.
`cop-web-2akq.onrender.com`) — there's no warning, no error, the Blueprint
step just succeeds. Check each static site's actual URL in the Render
dashboard (or try the plain `https://cop-web.onrender.com` /
`https://cop-admin.onrender.com` — a `404` with response header
`x-render-routing: no-server` means it got suffixed and that plain URL
belongs to no service of yours).

`PUBLIC_WEB_ORIGIN` (on `cop-api-public`) and `CORS_ORIGIN` (on
`cop-api-internal`) are `sync: false` in `render.yaml` for exactly this
reason — set each to the *actual* origin (scheme + real hostname) of the
corresponding static site:

- `cop-api-public` service → Environment → `PUBLIC_WEB_ORIGIN` → the real
  `cop-web` origin, e.g. `https://cop-web-2akq.onrender.com`
- `cop-api-internal` service → Environment → `CORS_ORIGIN` → the real
  `cop-admin` origin

**Why this matters more than a normal misconfigured env var:** the `cors`
package (`apps/api-public/src/app.ts`, `apps/api-internal/src/app.ts`) does
an exact string match and echoes back whatever this value is set to as
`Access-Control-Allow-Origin` regardless of the actual requesting origin. A
wrong value doesn't fail loudly — `curl`/server-to-server checks (including
`/healthz`) still return `200` normally, since `curl` doesn't enforce CORS.
Only a real browser loading the actual site enforces the mismatch, silently
blocking every API call while the page itself loads fine. If the site loads
but shows no data anywhere, this is the first thing to check.

### 5. Set a password for the seed reviewer (needed to log into the admin app)

From your machine, using the `cop_internal_api` connection string from step 4:

```
DATABASE_URL="postgres://cop_internal_api:cop_internal_dev_only@<host>.render.com/cop?sslmode=require" \
  npm run --workspace apps/api-internal create-admin -- --email=reviewer@example.org --password=<pick one>
```

(Needs a local `npm install` + `tsx` available — or exec into the
`cop-api-internal` container via Render's shell and run the built version,
`npm run --workspace apps/api-internal create-admin:built -- --email=... --password=...`,
per the note at the bottom of `apps/api-internal/Dockerfile`.)

### 6. Visit it

- Public site: `https://cop-web.onrender.com`
- Admin/review tool: `https://cop-admin.onrender.com` (log in with the
  reviewer credentials from step 5)

Free-tier Render web services spin down after inactivity and take ~30-60s
to wake on the next request — expected, not a bug, for a demo deployment.

## What's been verified vs. what's still unverified

**Verified locally** (by actually running it in this environment): the exact
`npm ci` → build `packages/shared-types` → build each app command sequence
the Dockerfiles and static-site build commands use; that both API services
still start correctly and pass their full test suites with the new
`PGSSLMODE` flag added (defaulting to off, so this didn't change existing
local/CI behavior); the exact env var names each service reads
(`PUBLIC_WEB_ORIGIN`, `CORS_ORIGIN`, `DATABASE_URL`, `PORT`,
`PGSSLMODE`) via direct source inspection, not memory.

**Verified against the live deployment** (plain HTTP checks from this
environment, no Render credentials needed for this part): Blueprint
provisioning produced working services — `cop-api-public` and
`cop-api-internal` both return `{"ok":true}` from `/healthz`, real seeded
data flows through `cop-api-public`'s actual endpoints, `cop-admin` serves
its real built app and its CORS setup against `cop-api-internal` is
correct. Also how §4b's `cop-web` hostname-collision bug was actually
caught, not hypothesized.

**Still not verified** (would need Docker/Render build-infra access this
environment doesn't have): the Dockerfiles' and static-site build commands'
behavior *during* a build on Render's infrastructure specifically, as
opposed to the resulting containers/sites once already running (which have
been checked). If a from-scratch redeploy ever fails at the build step
rather than the runtime step, that's the remaining unverified surface.

## Alternatives briefly considered

- **Railway**: similar shape to Render, but no longer has an indefinite
  free tier (trial-credit based now) — worse fit for "just a demo."
- **Vercel/Netlify**: excellent for the two static frontends, but not a
  natural fit for the two long-running Postgres-backed Express services
  without adapting them to serverless functions — would mean maintaining
  two different deployment models for one app. Not worth it for a demo.
- **Plain Docker Compose on a VPS**: most portable, reuses this repo's
  existing `db/migrate.sh`/`seed.sh` almost as-is, but requires the user to
  own/manage a server — more moving parts than "click deploy" for a
  preview-only ask. The two Dockerfiles added here would be most of the
  work if this path is wanted later; ask if so.
