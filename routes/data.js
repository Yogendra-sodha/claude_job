const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db');

// GET /api/data/export — export all data as JSON
router.get('/export', async (req, res) => {
  try {
    const profile = (await query('SELECT * FROM profiles WHERE id = 1')).rows[0] || {};
    delete profile.id; delete profile.updated_at;
    
    const settings = (await query('SELECT * FROM settings WHERE id = 1')).rows[0] || {};
    delete settings.id;
    
    // Get apps with their contacts and materials
    const apps = (await query('SELECT * FROM applications ORDER BY created_at DESC')).rows;
    for (const app of apps) {
      app.contacts = (await query('SELECT * FROM contacts WHERE app_id = $1', [app.id])).rows;
      app.materials = (await query('SELECT * FROM materials WHERE app_id = $1', [app.id])).rows
        .map(m => ({ k: m.kind, t: m.content, d: m.created_at }));
    }

    res.json({ profile, apps, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/data/import — import data from JSON
router.post('/import', async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const data = req.body;

    // Import profile
    if (data.profile) {
      const p = data.profile;
      const fields = ['name', 'title', 'email', 'phone', 'location', 'linkedin',
                       'portfolio', 'years', 'summary', 'skills', 'experience', 'education', 'demographics'];
      const values = fields.map(f => typeof p[f] === 'object' ? JSON.stringify(p[f]) : p[f] || '');
      await client.query(
        `INSERT INTO profiles (id, name, title, email, phone, location, linkedin, portfolio, years, summary, skills, experience, education, demographics, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = $1, title = $2, email = $3, phone = $4, location = $5,
           linkedin = $6, portfolio = $7, years = $8, summary = $9,
           skills = $10, experience = $11, education = $12, demographics = $13, updated_at = NOW()`,
        values
      );
    }

    // Import settings
    if (data.settings) {
      const s = data.settings;
      await client.query(
        `INSERT INTO settings (id, mode, api_key, model, adzuna_country, adzuna_where, adzuna_id, adzuna_key)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           mode = $1, api_key = $2, model = $3, adzuna_country = $4,
           adzuna_where = $5, adzuna_id = $6, adzuna_key = $7`,
        [s.mode || 'manual', s.key || s.api_key || '', s.model || 'gpt-4o-mini',
         s.adzuna?.country || s.adzuna_country || 'us', s.adzuna?.where || s.adzuna_where || '',
         s.adzuna?.id || s.adzuna_id || '', s.adzuna?.key || s.adzuna_key || '']
      );
    }

    // Import applications
    if (data.apps && Array.isArray(data.apps)) {
      for (const app of data.apps) {
        const aResult = await client.query(
          `INSERT INTO applications (company, role, status, referral, applied, followup, notes, jd)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [app.company || '', app.role || '', app.status || 'saved', app.referral || 'no',
           app.applied || null, app.followup || null, app.notes || '', (app.jd || '').slice(0, 5000)]
        );
        const newId = aResult.rows[0].id;

        // Import contacts for this app
        if (app.contacts && Array.isArray(app.contacts)) {
          for (const c of app.contacts) {
            await client.query(
              `INSERT INTO contacts (app_id, name, url, status, messaged, added)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [newId, c.name || '', c.url || '', c.status || 'to-message',
               c.messaged || null, c.added || null]
            );
          }
        }

        // Import materials for this app
        if (app.materials && Array.isArray(app.materials)) {
          for (const m of app.materials) {
            await client.query(
              `INSERT INTO materials (app_id, kind, content, created_at)
               VALUES ($1, $2, $3, $4)`,
              [newId, m.k || m.kind || '', (m.t || m.content || '').slice(0, 20000), m.d || m.created_at || null]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    res.json({ imported: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/data/wipe — delete all data
router.delete('/wipe', async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM materials');
    await client.query('DELETE FROM contacts');
    await client.query('DELETE FROM applications');
    await client.query(`UPDATE profiles SET name='', title='', email='', phone='', location='', linkedin='', portfolio='', years='', summary='', skills='', experience='', education='', demographics='{}' WHERE id = 1`);
    await client.query(`UPDATE settings SET mode='manual', api_key='', model='gpt-4o-mini', adzuna_country='us', adzuna_where='', adzuna_id='', adzuna_key='' WHERE id = 1`);
    await client.query('COMMIT');
    res.json({ wiped: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/data/extension — combined data for the Chrome extension
router.get('/extension', async (req, res) => {
  try {
    const profile = (await query('SELECT * FROM profiles WHERE id = 1')).rows[0] || {};
    delete profile.id; delete profile.updated_at;

    // Get the latest cover letter material
    const latestLetter = (await query(
      `SELECT m.content FROM materials m WHERE m.kind = 'cover' ORDER BY m.created_at DESC LIMIT 1`
    )).rows[0];

    res.json({
      profile: {
        fullName: profile.name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        location: profile.location || '',
        linkedin: profile.linkedin || '',
        portfolio: profile.portfolio || '',
        years: profile.years || '',
        summary: profile.summary || '',
        title: profile.title || '',
        skills: profile.skills || '',
        experience: profile.experience || '',
        education: profile.education || '',
        demographics: profile.demographics || '{}',
      },
      letter: latestLetter ? latestLetter.content : ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/data/sync — atomically replace all data (used by frontend store.set)
router.put('/sync', async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const data = req.body;

    // Sync profile
    if (data.profile) {
      const p = data.profile;
      const fields = ['name', 'title', 'email', 'phone', 'location', 'linkedin',
                       'portfolio', 'years', 'summary', 'skills', 'experience', 'education', 'demographics'];
      const values = fields.map(f => typeof p[f] === 'object' ? JSON.stringify(p[f]) : p[f] || '');
      await client.query(
        `INSERT INTO profiles (id, name, title, email, phone, location, linkedin, portfolio, years, summary, skills, experience, education, demographics, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = $1, title = $2, email = $3, phone = $4, location = $5,
           linkedin = $6, portfolio = $7, years = $8, summary = $9,
           skills = $10, experience = $11, education = $12, demographics = $13, updated_at = NOW()`,
        values
      );
    }

    // Sync settings
    if (data.settings) {
      const s = data.settings;
      await client.query(
        `INSERT INTO settings (id, mode, api_key, model, adzuna_country, adzuna_where, adzuna_id, adzuna_key)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           mode = $1, api_key = $2, model = $3, adzuna_country = $4,
           adzuna_where = $5, adzuna_id = $6, adzuna_key = $7`,
        [s.mode || 'manual', s.key || s.api_key || '', s.model || 'gpt-4o-mini',
         s.adzuna?.country || s.adzuna_country || 'us', s.adzuna?.where || s.adzuna_where || '',
         s.adzuna?.id || s.adzuna_id || '', s.adzuna?.key || s.adzuna_key || '']
      );
    }

    // Sync applications (Atomic wipe and replace for apps, contacts, materials)
    if (data.apps && Array.isArray(data.apps)) {
      await client.query('DELETE FROM applications'); // cascades to contacts and materials
      for (const app of data.apps) {
        const aResult = await client.query(
          `INSERT INTO applications (company, role, status, referral, applied, followup, notes, jd)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [app.company || '', app.role || '', app.status || 'saved', app.referral || 'no',
           app.applied || null, app.followup || null, app.notes || '', (app.jd || '').slice(0, 5000)]
        );
        const newId = aResult.rows[0].id;

        if (app.contacts && Array.isArray(app.contacts)) {
          for (const c of app.contacts) {
            await client.query(
              `INSERT INTO contacts (app_id, name, url, status, messaged, added)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [newId, c.name || '', c.url || '', c.status || 'to-message',
               c.messaged || null, c.added || null]
            );
          }
        }

        if (app.materials && Array.isArray(app.materials)) {
          for (const m of app.materials) {
            await client.query(
              `INSERT INTO materials (app_id, kind, content, created_at)
               VALUES ($1, $2, $3, $4)`,
              [newId, m.k || m.kind || '', (m.t || m.content || '').slice(0, 20000), m.d || m.created_at || null]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    res.json({ synced: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
