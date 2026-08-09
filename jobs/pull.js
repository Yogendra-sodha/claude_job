'use strict';
const { query } = require('../db');
const { FETCHERS } = require('./ats');
const { matchesRole, matchesLocation, scoreJob } = require('./filter');

let running = false;
const isRunning = () => running;

async function pullCompany(c) {
  const fetcher = FETCHERS[c.ats];
  if (!fetcher) return { inserted: 0, updated: 0 };
  let rows;
  try { rows = await fetcher(c.token); }
  catch (e) {
    await query('UPDATE companies SET last_error=$2, last_pulled=NOW() WHERE id=$1', [c.id, e.message]);
    return { inserted: 0, updated: 0, error: e.message };
  }
  const jobs = rows.filter((j) => matchesRole(j.title) && matchesLocation(j.location, j.remote));
  let inserted = 0, updated = 0;
  for (const j of jobs) {
    const res = await query(
      `INSERT INTO jobs (company_id, company, ats, ext_id, title, location, remote, url, department, posted_at, score, description, first_seen, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
       ON CONFLICT (ats, ext_id) DO UPDATE SET
         title=EXCLUDED.title, location=EXCLUDED.location, remote=EXCLUDED.remote, url=EXCLUDED.url,
         department=EXCLUDED.department, posted_at=EXCLUDED.posted_at, score=EXCLUDED.score,
         description=EXCLUDED.description, last_seen=NOW(), active=TRUE
       RETURNING (xmax = 0) AS inserted`,
      [c.id, c.name, c.ats, j.extId, j.title, j.location, j.remote, j.url, j.department, j.postedAt, scoreJob(j), j.description]
    );
    if (res.rows[0].inserted) inserted++; else updated++;
  }
  await query('UPDATE companies SET last_pulled=NOW(), last_error=NULL WHERE id=$1', [c.id]);
  return { inserted, updated };
}

async function pullAll() {
  if (running) return { skipped: 'already running' };
  running = true;
  const startedAt = new Date();
  try {
    const companies = (await query('SELECT * FROM companies WHERE active = TRUE ORDER BY id')).rows;
    let inserted = 0, updated = 0, failed = 0;
    const CONC = 5;
    for (let i = 0; i < companies.length; i += CONC) {
      const batch = companies.slice(i, i + CONC);
      const rs = await Promise.all(batch.map((c) => pullCompany(c).catch((e) => ({ inserted: 0, updated: 0, error: e.message }))));
      rs.forEach((r) => { inserted += r.inserted || 0; updated += r.updated || 0; if (r.error) failed++; });
    }
    // Delist jobs not seen this run (their company was pulled but the posting is gone).
    const del = await query('UPDATE jobs SET active=FALSE WHERE active=TRUE AND last_seen < $1', [startedAt]);
    return { companies: companies.length, inserted, updated, failed, deactivated: del.rowCount, ranAt: startedAt.toISOString() };
  } finally { running = false; }
}
module.exports = { pullCompany, pullAll, isRunning };
