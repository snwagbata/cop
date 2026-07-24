# Deploying COP (demo/preview only)

**Read this before deploying anything.** This covers getting the current
build — running entirely on synthetic, fictional seed data — onto a public
URL for preview purposes. It does **not** cover real public launch: per
`DESIGN.md` §3, that needs a legal entity, insurance, and First Amendment
counsel review first, none of which has happened. Don't put real officer
data into whatever you deploy from this doc.

**Honesty check on this doc itself**: I have no hosting-platform credentials
in this environment (verified — no Render/Railway/Fly/Vercel connector is
configured), so nothing below has been deployed and confirmed working
end-to-end the way the rest of this repo has been. Every command and env
var name referenced here was cross-checked against the actual source (grep
for the exact `process.env.X` reads, the actual `package.json` script
names, an actual local build/run of both API services with the new
`PGSSLMODE` flag) — but the deployment platform's own behavior (Blueprint
provisioning, `fromDatabase`/role handling) is not something I could
exercise for real. If something in here doesn't match what you see in the
Render dashboard, that's the gap — tell me and I'll fix it.

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

## What I could verify locally vs. what's unverified

**Verified** (by actually running it in this environment): the exact
`npm ci` → build `packages/shared-types` → build each app command sequence
the Dockerfiles and static-site build commands use; that both API services
still start correctly and pass their full test suites with the new
`PGSSLMODE` flag added (defaulting to off, so this didn't change existing
local/CI behavior); the exact env var names each service reads
(`PUBLIC_WEB_ORIGIN`, `CORS_ORIGIN`, `DATABASE_URL`, `PORT`,
`PGSSLMODE`) via direct source inspection, not memory.

**Not verified** (no Docker daemon, no hosting credentials in this
environment): that the Dockerfiles actually build successfully end-to-end,
that Render's Blueprint provisioning behaves exactly as described, that the
static sites' build commands succeed on Render's build infrastructure
specifically. These were written carefully but are the part most likely to
need a follow-up fix once someone with real credentials tries it.

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
