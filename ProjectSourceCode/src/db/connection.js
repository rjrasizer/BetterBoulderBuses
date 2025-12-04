// connection.js
require('dotenv').config();
const pgp = require('pg-promise')();

let db;

// If Render provides DATABASE_URL, use it
if (process.env.DATABASE_URL) {
  console.log("Using Render DATABASE_URL for Postgres connection.");

  db = pgp({
    connectionString: process.env.DATABASE_URL,
    max: 30,
    ssl: {
      rejectUnauthorized: false
    }
  });

} else {
  console.log("Using local Postgres connection settings.");

  db = pgp({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 30
  });
}

module.exports = db;

db.connect()
  .then(obj => {
    console.log('Connected to Postgres!');
    obj.done();
  })
  .catch(error => {
    console.error('Connection error:', error.message);
  });
