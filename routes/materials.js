const express = require('express');
const router = express.Router();
const { query } = require('../db');

// GET /api/materials?app_id=X — list materials for an application
router.get('/', async (req, res) => {
  try {
    const appId = req.query.app_id;
    if (!appId) return res.status(400).json({ error: 'app_id required' });
    const result = await query('SELECT * FROM materials WHERE app_id = $1 ORDER BY created_at DESC', [appId]);
    res.json(result.rows.map(m => ({ id: m.id, k: m.kind, t: m.content, d: m.created_at })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/materials — add a material to an application
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.app_id) return res.status(400).json({ error: 'app_id required' });
    const result = await query(
      `INSERT INTO materials (app_id, kind, content, created_at)
       VALUES ($1, $2, $3, CURRENT_DATE)
       RETURNING *`,
      [b.app_id, b.kind || b.k || '', (b.content || b.t || '').slice(0, 20000)]
    );
    const m = result.rows[0];
    res.status(201).json({ id: m.id, k: m.kind, t: m.content, d: m.created_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/materials/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM materials WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
