/**
 * JobFlow Server
 * Serves the frontend and REST API on http://localhost:3000
 * All data stored in PostgreSQL for true persistence
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(cors());

// Serve static files (index.html, etc.)
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  extensions: ['html']
}));

// API Routes
app.use('/api/profile', require('./routes/profile'));
app.use('/api/apps', require('./routes/apps'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/data', require('./routes/data'));
app.use('/api/gpt-fill', require('./routes/gptfill'));
app.use('/api/jobs', require('./routes/jobs'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fallback: serve index.html for any non-API route
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    next();
  }
});

// Error handler check
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: err.message });
});

// Ensure job-sourcing tables exist, then run a daily pull in-process (no cron dep):
// on boot and every 6h, pull all boards if the last pull is > 20h old.
const { pullAll } = require('./jobs/pull');
async function maybePull() {
  try {
    const r = await require('./db').query('SELECT MAX(last_pulled) AS last FROM companies');
    const last = r.rows[0].last ? new Date(r.rows[0].last).getTime() : 0;
    if (Date.now() - last > 20 * 3600 * 1000) {
      console.log('[jobs] daily pull starting…');
      pullAll().then((x) => console.log('[jobs] pull done', JSON.stringify(x))).catch((e) => console.warn('[jobs] pull failed', e.message));
    }
  } catch (e) { console.warn('[jobs] scheduler:', e.message); }
}
require('./jobs/db').ensureJobsTables()
  .then(() => { console.log('  ✓ job tables ready'); maybePull(); setInterval(maybePull, 6 * 3600 * 1000); })
  .catch((e) => console.warn('  job tables init failed:', e.message));

// Start server on localhost only (security)
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ⚡ JobFlow server running at http://localhost:${PORT}\n`);
  console.log(`  Open http://localhost:${PORT} in your browser`);
  console.log(`  Press Ctrl+C to stop\n`);
});