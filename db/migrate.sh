#!/usr/bin/env bash
# Applies all migrations in db/migrations/, in filename order, to
# $DATABASE_URL (defaults to the local docker-compose Postgres).
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://cop:cop_dev_only@localhost:5432/cop}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for f in "$SCRIPT_DIR"/migrations/*.sql; do
    echo "==> Applying $(basename "$f")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Migrations complete."
