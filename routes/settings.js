const express = require('express');
const router = express.Router();
const { query } = require('../db');

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM settings WHERE id = 1');
    if (result.rows.length === 0) {
      return res.json({ mode: 'manual', model: 'gpt-4o-mini' });
    }
    const s = result.rows[0];
    delete s.id;
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  try {
    const values = [
      req.body.mode || 'manual',
      req.body.api_key || req.body.key || '',
      req.body.model || 'gpt-5',
      req.body.adzuna_country || req.body.adzuna?.country || 'us',
      req.body.adzuna_where || req.body.adzuna?.where || '',
      req.body.adzuna_id || req.body.adzuna?.id || '',
      req.body.adzuna_key || req.body.adzuna?.key || '',
      req.body.api_base || req.body.apiBase || 'https://api.openai.com/v1',
    ];

    const result = await query(
      `INSERT INTO settings (id, mode, api_key, model, adzuna_country, adzuna_where, adzuna_id, adzuna_key, api_base)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         mode = $1, api_key = $2, model = $3, adzuna_country = $4,
         adzuna_where = $5, adzuna_id = $6, adzuna_key = $7, api_base = $8
       RETURNING *`,
      values
    );

    const s = result.rows[0];
    delete s.id;
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
