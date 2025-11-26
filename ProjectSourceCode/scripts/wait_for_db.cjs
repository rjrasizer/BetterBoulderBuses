// scripts/wait_for_db.cjs
const { Client } = require('pg');
require('dotenv').config();

const MAX_RETRIES = 40;
const RETRY_DELAY_MS = 1000;

const config = {
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
};

async function waitForDb() {
  console.log("Waiting for Postgres...");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new Client(config);

    try {
      await client.connect();
      await client.end();
      console.log(`Postgres is ready (attempt ${attempt}).`);
      return true;
    } catch (err) {
      console.log(
        `Postgres not ready yet (${attempt}/${MAX_RETRIES}): ${err.message}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  console.error("Postgres did not become ready in time.");
  return false; // ← IMPORTANT: DO NOT THROW HERE
}

module.exports = waitForDb;
