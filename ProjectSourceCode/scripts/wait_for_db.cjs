// scripts/wait_for_db.cjs
// Simple wait-for-Postgres loop for Docker startup dependency
const { Client } = require('pg');
require('dotenv').config();

const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1000;

const config = {
  host: 'db',
  port: 5432,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
};

async function wait() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = new Client(config);
      await client.connect();
      await client.end();
      console.log(`✅ Postgres is up (attempt ${attempt})`);
      return;
    } catch (err) {
      console.log(`⏳ Waiting for Postgres (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  console.error(`❌ Postgres not ready after ${MAX_RETRIES} attempts`);
  process.exit(1);
}

wait();

