const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'jobflow',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test connection on import
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

/**
 * Run a query with parameters
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) {
    console.log('Slow query:', { text: text.slice(0, 80), duration, rows: result.rowCount });
  }
  return result;
}

/**
 * Get a client from the pool for transactions
 */
async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };
