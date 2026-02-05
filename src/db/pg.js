const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

module.exports = { pool, query };
