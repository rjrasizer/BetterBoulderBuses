#!/bin/bash
set -e

echo "=== Running GTFS import script ==="

# Go to project root inside container
cd /repository

# Run your Node importer
node importGtfs.cjs

echo "=== GTFS import completed ==="
