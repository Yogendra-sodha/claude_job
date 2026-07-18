const express = require('express');
const router = express.Router();
const { query } = require('../db');

// GET /api/profile — get the single profile row
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM profiles WHERE id = 1');
    if (result.rows.length === 0) {
      return res.json({});
    }
    const p = result.rows[0];
    // Remove internal fields
    delete p.id;
    delete p.updated_at;
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile — upsert the profile
router.put('/', async (req, res) => {
  try {
    const fields = ['name', 'title', 'email', 'phone', 'location', 'linkedin',
                     'portfolio', 'years', 'summary', 'skills', 'experience', 'education', 'demographics'];
    const values = fields.map(f => req.body[f] || '');
    
    const result = await query(
      `INSERT INTO profiles (id, name, title, email, phone, location, linkedin, portfolio, years, summary, skills, experience, education, demographics, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = $1, title = $2, email = $3, phone = $4, location = $5,
         linkedin = $6, portfolio = $7, years = $8, summary = $9,
         skills = $10, experience = $11, education = $12, demographics = $13, updated_at = NOW()
       RETURNING *`,
      values
    );
    
    const p = result.rows[0];
    delete p.id;
    delete p.updated_at;
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
