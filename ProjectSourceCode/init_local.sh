#!/bin/sh

echo "Waiting for DB..."
node ./scripts/wait_for_db.cjs

echo "Creating schema..."
psql "$DATABASE_URL" -f ./src/init_data/create.sql

echo "Preparing GTFS..."
node ./scripts/prepare_gtfs.cjs

echo "Importing GTFS..."
node ./importGtfs.cjs

echo "Starting server..."
npm start
