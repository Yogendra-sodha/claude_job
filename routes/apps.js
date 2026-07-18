const express = require('express');
const router = express.Router();
const { query } = require('../db');

// GET /api/apps — list all applications (with contacts & materials counts)
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT a.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', c.id, 'name', c.name, 'url', c.url, 'status', c.status,
          'messaged', c.messaged, 'added', c.added
        )) FILTER (WHERE c.id IS NOT NULL), '[]') AS contacts,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', m.id, 'k', m.kind, 't', m.content, 'd', m.created_at
        )) FILTER (WHERE m.id IS NOT NULL), '[]') AS materials
      FROM applications a
      LEFT JOIN contacts c ON c.app_id = a.id
      LEFT JOIN materials m ON m.app_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apps — create a new application
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const result = await query(
      `INSERT INTO applications (company, role, status, referral, applied, followup, notes, jd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [b.company || '', b.role || '', b.status || 'saved', b.referral || 'no',
       b.applied || null, b.followup || null, b.notes || '', (b.jd || '').slice(0, 5000)]
    );
    const app = result.rows[0];
    app.contacts = [];
    app.materials = [];
    res.status(201).json(app);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/apps/:id — update an application
router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const result = await query(
      `UPDATE applications SET
         company = COALESCE($2, company),
         role = COALESCE($3, role),
         status = COALESCE($4, status),
         referral = COALESCE($5, referral),
         applied = $6,
         followup = $7,
         notes = COALESCE($8, notes),
         jd = COALESCE($9, jd)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, b.company, b.role, b.status, b.referral,
       b.applied || null, b.followup || null, b.notes, b.jd]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/apps/:id — delete an application (cascades to contacts & materials)
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM applications WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
