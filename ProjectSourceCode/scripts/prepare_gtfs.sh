#!/usr/bin/env bash
set -euo pipefail

# Prepare GTFS tables for fast querying using Postgres inside docker-compose
# Usage: bash scripts/prepare_gtfs.sh

# Defaults align with .env
DB_NAME=${POSTGRES_DB:-users_db}
DB_USER=${POSTGRES_USER:-postgres}

# Ensure docker compose is available
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to run this script" >&2
  exit 1
fi

# Compose shorthand to run psql commands
DC=(docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME")

echo "Analyzing and preparing GTFS tables in database '$DB_NAME'..."

# Stream the SQL file into psql inside the db container
"${DC[@]}" -v ON_ERROR_STOP=1 -f - < sql/prepare_gtfs.sql

echo "Done. Quick verifies above should show sample outputs."

