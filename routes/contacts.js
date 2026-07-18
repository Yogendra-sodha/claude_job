const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Note: These routes are mounted at /api/contacts
// But contacts are also accessible via /api/apps/:id/contacts (set up in server.js)

// GET /api/contacts?app_id=X — list contacts for an application
router.get('/', async (req, res) => {
  try {
    const appId = req.query.app_id;
    if (!appId) return res.status(400).json({ error: 'app_id required' });
    const result = await query('SELECT * FROM contacts WHERE app_id = $1 ORDER BY added DESC', [appId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contacts — add a contact to an application
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.app_id) return res.status(400).json({ error: 'app_id required' });
    const result = await query(
      `INSERT INTO contacts (app_id, name, url, status, added)
       VALUES ($1, $2, $3, $4, CURRENT_DATE)
       RETURNING *`,
      [b.app_id, b.name || '', b.url || '', b.status || 'to-message']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/contacts/:id — update a contact
router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const result = await query(
      `UPDATE contacts SET
         name = COALESCE($2, name),
         url = COALESCE($3, url),
         status = COALESCE($4, status),
         messaged = $5
       WHERE id = $1
       RETURNING *`,
      [req.params.id, b.name, b.url, b.status, b.messaged || null]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM contacts WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
