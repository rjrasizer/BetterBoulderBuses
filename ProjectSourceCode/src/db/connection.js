// connection.js
require('dotenv').config();
const pgp = require('pg-promise')();

const dbConfig = {
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 30
};

const db = pgp(dbConfig);

module.exports = db;

db.connect()
  .then(obj => {
    console.log('Connected to Postgres!');
    obj.done(); // release the connection
  })
  .catch(error => {
    console.error('Connection error:', error.message);
  });
