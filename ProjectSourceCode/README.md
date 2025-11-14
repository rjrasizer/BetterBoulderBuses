BetterBoulderBuses – GTFS Setup

Quick steps to import GTFS and prepare the database for fast queries.

Prerequisites
- Docker and docker-compose installed
- `google_transit.zip` present in the project root (already included)
- `docker compose up -d` running the `db` and `web` services

Import GTFS (if tables are empty)
- Run: `npm run db:import-gtfs`
  - This unzips `google_transit.zip` and loads all GTFS .txt files into Postgres.

Prepare GTFS for fast querying
- Run: `npm run db:prepare-gtfs`
  - Creates indexes, helper fields, service date expansions, and precomputed shapes/stops.
  - Re-run safe; uses IF NOT EXISTS / ON CONFLICT where applicable.

Manual one-liners (optional)
- You can also run the SQL directly:
  - `docker compose exec -T db psql -U postgres -d users_db -v ON_ERROR_STOP=1 -f - < sql/prepare_gtfs.sql`

Notes
- The `departure_secs` calculation uses proper hour/minute multipliers.
- If your GTFS feed lacks `calendar_dates.txt`, an empty table is created so service date logic still runs safely.

