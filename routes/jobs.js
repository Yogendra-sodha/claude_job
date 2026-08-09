// GET /api/jobs — ranked jobs from the DB; plus /api/jobs/companies registry + refresh.
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { pullAll, isRunning } = require('../jobs/pull');
const { seedCompanies, addCompany, importYc } = require('../jobs/seed');

router.get('/', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || '45', 10) || 45, 180);
    const q = (req.query.q || '').trim();
    const sort = req.query.sort === 'new' ? 'first_seen DESC, score DESC' : 'score DESC, first_seen DESC';
    const params = [String(days)];
    let where = `active = TRUE AND (posted_at IS NULL OR posted_at > NOW() - ($1 || ' days')::interval)`;
    if (q) { params.push('%' + q + '%'); where += ` AND (title ILIKE $${params.length} OR company ILIKE $${params.length})`; }
    if (req.query.new === '1') where += ` AND first_seen::date = CURRENT_DATE`;
    const rows = (await query(
      `SELECT id, company, ats, title, location, remote, url, department, posted_at, score, first_seen,
              (first_seen::date = CURRENT_DATE) AS is_new
         FROM jobs WHERE ${where} ORDER BY ${sort} LIMIT 500`, params)).rows;
    const totals = (await query(
      `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE first_seen::date = CURRENT_DATE)::int new_today
         FROM jobs WHERE active = TRUE`)).rows[0];
    res.json({ jobs: rows, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/refresh', (req, res) => {
  if (isRunning()) return res.json({ running: true, message: 'A pull is already in progress.' });
  pullAll().then((r) => console.log('[jobs] refresh', JSON.stringify(r))).catch((e) => console.warn('[jobs] refresh failed', e.message));
  res.json({ started: true });
});

router.get('/companies', async (req, res) => {
  try {
    const rows = (await query(
      `SELECT c.id, c.name, c.ats, c.token, c.source, c.active, c.last_pulled, c.last_error,
              (SELECT COUNT(*)::int FROM jobs j WHERE j.company_id = c.id AND j.active) AS jobs
         FROM companies c ORDER BY jobs DESC, name`)).rows;
    res.json({ companies: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/companies', async (req, res) => {
  try {
    const r = await addCompany(req.body || {});
    if (r && r.error) return res.status(400).json(r);
    res.json({ company: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/companies/:id', async (req, res) => {
  try { await query('DELETE FROM companies WHERE id = $1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/companies/seed', async (req, res) => {
  try { res.json(await seedCompanies()); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/companies/import-yc', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.body && req.body.limit) || 100, 300);
    const offset = parseInt(req.body && req.body.offset) || 0;
    res.json(await importYc({ limit, offset }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
