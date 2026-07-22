#!/usr/bin/env bash
# Loads synthetic seed data from db/seed/ into $DATABASE_URL. Run after
# migrate.sh, against an empty database (seed IDs are fixed UUIDs and will
# conflict on a second run).
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://cop:cop_dev_only@localhost:5432/cop}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for f in "$SCRIPT_DIR"/seed/*.sql; do
    echo "==> Loading $(basename "$f")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Seed data loaded."
