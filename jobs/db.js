// Idempotent creation of the job-sourcing tables, run on server boot so the user
// never has to re-run db/init.js after pulling this update.
const { query } = require('../db');

async function ensureJobsTables() {
  await query(`CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, ats TEXT NOT NULL, token TEXT NOT NULL,
    website TEXT, source TEXT DEFAULT 'manual', active BOOLEAN DEFAULT TRUE,
    last_pulled TIMESTAMPTZ, last_error TEXT, added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (ats, token))`);
  await query(`CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    company TEXT NOT NULL, ats TEXT NOT NULL, ext_id TEXT NOT NULL, title TEXT NOT NULL,
    location TEXT, remote BOOLEAN DEFAULT FALSE, url TEXT NOT NULL, department TEXT,
    posted_at TIMESTAMPTZ, score INTEGER DEFAULT 0, description TEXT,
    first_seen TIMESTAMPTZ DEFAULT NOW(), last_seen TIMESTAMPTZ DEFAULT NOW(),
    active BOOLEAN DEFAULT TRUE, UNIQUE (ats, ext_id))`);
  await query('CREATE INDEX IF NOT EXISTS jobs_posted_idx ON jobs (posted_at DESC)');
  await query('CREATE INDEX IF NOT EXISTS jobs_active_idx ON jobs (active, first_seen DESC)');
}
module.exports = { ensureJobsTables };
