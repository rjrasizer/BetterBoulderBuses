import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  host: process.env.POSTGRES_HOST, // use Render host if set, otherwise default to local Docker host
  port: process.env.POSTGRES_PORT || 5432,  // same thing for port
  database: process.env.POSTGRES_DB,
});

export default pool;
