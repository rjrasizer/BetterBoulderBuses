// scripts/prepare_gtfs.cjs
// Prepare GTFS tables for fast querying using Postgres inside docker-compose

const fs = require('fs');
const path = require('path');
const pgp = require('pg-promise')();
require('dotenv').config();

const dbConfig = {
  host: process.env.POSTGRES_HOST, 
  port: process.env.POSTGRES_PORT,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};

const db = pgp(dbConfig);

async function run() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'prepare_gtfs.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log(`Running prepare_gtfs.sql against ${dbConfig.database}...`);
  try {
    // The SQL contains queries/notices, so use multi to allow results.
    await db.multi(sql);
    console.log('✅ GTFS tables prepared successfully.');
  } catch (err) {
    console.error('❌ Failed to prepare GTFS tables:', err.message);
    process.exitCode = 1;
  } finally {
    pgp.end();
  }
}

run();
