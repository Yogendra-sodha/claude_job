'use strict';
const { query } = require('../db');
const { detectAts } = require('./detect');
const SEED = require('./seed-companies.json');

async function upsertCompany(c) {
  const r = await query(
    `INSERT INTO companies (name, ats, token, website, source)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (ats, token) DO UPDATE SET name = EXCLUDED.name, active = TRUE
     RETURNING *`,
    [c.name, c.ats, c.token, c.website || null, c.source || 'manual']
  );
  return r.rows[0];
}

async function seedCompanies() {
  let added = 0;
  for (const c of SEED) { await upsertCompany({ ...c, source: 'seed' }); added++; }
  return { added };
}

// Paste a careers URL (or provide name+ats+token) → register it.
async function addCompany(input) {
  if (input.ats && input.token) return upsertCompany({ ...input, source: 'manual' });
  if (!input.url) return { error: 'need a url or {name,ats,token}' };
  const hit = await detectAts(input.url);
  if (!hit) return { error: 'No Greenhouse/Lever/Ashby board found at that URL (likely Workday/Oracle — Phase 2).' };
  return upsertCompany({ name: input.name || hit.token, ats: hit.ats, token: hit.token, website: input.url, source: 'manual' });
}

// The YC directory is a ~10MB document that changes at most daily; cache it so a
// multi-batch scan downloads it once instead of once per batch.
const YC_URL = 'https://yc-oss.github.io/api/companies/all.json';
const YC_TTL = 6 * 3600 * 1000;
let ycCache = { at: 0, data: null };
async function fetchYcDirectory() {
  if (ycCache.data && Date.now() - ycCache.at < YC_TTL) return ycCache.data;
  const data = await (await fetch(YC_URL, { signal: AbortSignal.timeout(30000) })).json();
  ycCache = { at: Date.now(), data };
  return data;
}

// Bounded YC import: fetch the directory, detect ATS on each website, register
// hits. Resumable via offset so it never blocks or hammers. Each company is a
// different host, so we probe several at once — the per-host rate is still one
// request at a time.
async function importYc({ limit = 100, offset = 0, concurrency = 8 } = {}) {
  const all = await fetchYcDirectory();
  const slice = all.slice(offset, offset + limit).filter((c) => c.website);
  let scanned = 0, added = 0, next = 0;
  async function worker() {
    while (true) {
      const c = slice[next++];
      if (!c) return;
      scanned++;
      try {
        const exists = (await query('SELECT 1 FROM companies WHERE website = $1 LIMIT 1', [c.website])).rowCount;
        if (exists) continue;
        const hit = await detectAts(c.website);
        if (hit) { await upsertCompany({ name: c.name, ats: hit.ats, token: hit.token, website: c.website, source: 'yc' }); added++; }
      } catch (e) { /* skip */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, slice.length) }, worker));
  return { scanned, added, nextOffset: offset + limit, total: all.length };
}
module.exports = { seedCompanies, addCompany, importYc, upsertCompany };
