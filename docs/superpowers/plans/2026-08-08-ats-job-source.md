# ATS Job Source (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull Data-Engineer / Data-Analyst / Analytics-Engineer jobs from Greenhouse/Lever/Ashby into Postgres daily, and show them ranked in Find Jobs — every job one-click applyable via ⚡.

**Architecture:** A new `jobs/` module (pure fetch+normalize, filter, ATS detect, pull orchestration, seed) behind a `routes/jobs.js` API, backed by two new Postgres tables. `server.js` mounts the route and runs an in-process daily pull. `index.html` Find Jobs loads from the DB. Backend is fully testable via `curl` before the UI is touched.

**Tech Stack:** Node 24 (global `fetch`), Express, `pg` (via `db.js` `query`), vanilla-JS `index.html`. No new npm deps.

## Global Constraints

- No new npm dependencies (Node global `fetch`; in-process scheduler).
- DB access only through `db.js` `query(text, params)` (parameterized — never string-concat SQL).
- ATS scope: `greenhouse` | `lever` | `ashby` only. Location: US + Remote-US. No sponsorship filter.
- All network calls time-boxed (`AbortSignal.timeout(12000)`); one bad company never aborts a batch.
- Route file pattern: `const router = require('express').Router(); … module.exports = router;`.
- Commit AND push to `develop` after every task.

---

### Task 1: DB tables (companies, jobs) + boot-time ensure

**Files:**
- Modify: `db/schema.sql` (append the two tables)
- Create: `jobs/db.js` (ensureTables helper)
- Modify: `server.js` (call ensureTables on boot)

**Interfaces:**
- Produces: tables `companies`, `jobs`; `ensureJobsTables(): Promise<void>`.

- [ ] **Step 1: Append tables to `db/schema.sql`** (verbatim from the spec's Data model): the
  `CREATE TABLE IF NOT EXISTS companies (…)`, `CREATE TABLE IF NOT EXISTS jobs (…)`, and the two
  `CREATE INDEX IF NOT EXISTS` statements.

- [ ] **Step 2: Create `jobs/db.js`:**

```js
// Idempotent creation of the job-sourcing tables, run on server boot so the user
// never has to re-run db/init.js after pulling this update.
const { query } = require('../db');

async function ensureJobsTables() {
  await query(`CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, ats TEXT NOT NULL, token TEXT NOT NULL,
    website TEXT, source TEXT DEFAULT 'manual', active BOOLEAN DEFAULT TRUE,
    last_pulled TIMESTAMPTZ, last_error TEXT, added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (ats, token))`);
  await query(`CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    company TEXT NOT NULL, ats TEXT NOT NULL, ext_id TEXT NOT NULL, title TEXT NOT NULL,
    location TEXT, remote BOOLEAN DEFAULT FALSE, url TEXT NOT NULL, department TEXT,
    posted_at TIMESTAMPTZ, score INTEGER DEFAULT 0, description TEXT,
    first_seen TIMESTAMPTZ DEFAULT NOW(), last_seen TIMESTAMPTZ DEFAULT NOW(),
    active BOOLEAN DEFAULT TRUE, UNIQUE (ats, ext_id))`);
  await query('CREATE INDEX IF NOT EXISTS jobs_posted_idx ON jobs (posted_at DESC)');
  await query('CREATE INDEX IF NOT EXISTS jobs_active_idx ON jobs (active, first_seen DESC)');
}
module.exports = { ensureJobsTables };
```

- [ ] **Step 3: Call it on boot** — in `server.js`, before `app.listen`, add:

```js
require('./jobs/db').ensureJobsTables()
  .then(() => console.log('  ✓ job tables ready'))
  .catch((e) => console.warn('  job tables init failed:', e.message));
```

- [ ] **Step 4: Verify** — `node -e "require('./jobs/db').ensureJobsTables().then(()=>{console.log('ok');process.exit(0)})"`
  Expected: `ok`, and `psql` shows both tables.

- [ ] **Step 5: Commit + push**

```bash
git add db/schema.sql jobs/db.js server.js
git commit -m "feat(jobs): companies + jobs tables, ensured on boot"
git push origin develop
```

---

### Task 2: `jobs/filter.js` — role/location match + score (TDD)

**Files:**
- Create: `jobs/filter.js`
- Test: `jobs/filter.test.js`

**Interfaces:**
- Produces: `matchesRole(title): boolean`, `matchesLocation(loc, remote): boolean`, `scoreJob(job): number`.

- [ ] **Step 1: Write the failing test `jobs/filter.test.js`:**

```js
const F = require('./filter');
let fail = 0; const eq = (g, w, l) => { console.log(g === w ? 'PASS' : 'FAIL', l); if (g !== w) fail++; };
// matchesRole
eq(F.matchesRole('Senior Data Engineer'), true, 'DE');
eq(F.matchesRole('Analytics Engineer'), true, 'AE');
eq(F.matchesRole('Data Analyst, Growth'), true, 'DA');
eq(F.matchesRole('Business Intelligence Developer'), true, 'BI');
eq(F.matchesRole('Software Engineer, Frontend'), false, 'not SWE');
eq(F.matchesRole('Financial Analyst'), false, 'not financial analyst');
eq(F.matchesRole('Sales Development Rep'), false, 'not sales');
// matchesLocation
eq(F.matchesLocation('New York, NY', false), true, 'US city');
eq(F.matchesLocation('', true), true, 'remote');
eq(F.matchesLocation('Remote - US', true), true, 'remote-US');
eq(F.matchesLocation('London, UK', false), false, 'UK out');
eq(F.matchesLocation('Bengaluru, India', false), false, 'India out');
eq(F.matchesLocation('Remote - EMEA', true), false, 'remote EMEA out');
// scoreJob ordering
const now = Date.now();
const nyNew = F.scoreJob({ title: 'Data Engineer', location: 'Jersey City, NJ', remote: false, postedAt: new Date(now).toISOString() });
const remoteOld = F.scoreJob({ title: 'Data Analyst', location: 'Remote - US', remote: true, postedAt: new Date(now - 40 * 864e5).toISOString() });
eq(nyNew > remoteOld, true, 'NYC+new outranks remote+old');
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED'); process.exitCode = fail ? 1 : 0;
```

- [ ] **Step 2: Run it, verify it fails** — `node jobs/filter.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `jobs/filter.js`:**

```js
'use strict';
const ROLE_RE = /data engineer|analytics engineer|data analyst|business intelligence|\bbi\b|data (platform|warehouse|scientist)|data infrastructure|\betl\b|\bdbt\b|\banalytics\b/i;
// Reject titles that merely contain "analyst" in an unrelated domain.
const ROLE_NEG = /financial analyst|sales|marketing analyst|credit analyst|risk analyst|research analyst|hr analyst|policy analyst/i;
function matchesRole(title) {
  const t = (title || '').trim();
  if (!t) return false;
  if (ROLE_NEG.test(t) && !/data|analytics engineer/i.test(t)) return false;
  return ROLE_RE.test(t);
}

const US_RE = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b|united states|\bu\.?s\.?a?\.?\b|new york|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles|remote - us|us remote|remote \(us|remote, us/i;
const NON_US_RE = /india|london|\buk\b|united kingdom|ireland|germany|france|spain|poland|emea|apac|europe|canada|toronto|bengaluru|bangalore|singapore|australia|brazil|mexico|latam|remote - (emea|apac|europe|india|canada|uk)/i;
function matchesLocation(loc, remote) {
  const l = (loc || '').trim();
  if (NON_US_RE.test(l)) return false;
  if (remote) return true;              // remote with no non-US marker → treat as US-remote
  if (!l) return false;
  return US_RE.test(l);
}

const NYC_RE = /new york|nyc|\bny\b|jersey|newark|hoboken|new jersey|\bnj\b|brooklyn|manhattan/i;
const EXACT_RE = /^(senior |staff |lead |principal )?(data engineer|analytics engineer)\b/i;
function scoreJob(job) {
  let s = 0;
  const days = job.postedAt ? Math.max(0, (Date.now() - Date.parse(job.postedAt)) / 864e5) : 60;
  s += Math.max(0, 40 - Math.round(days));           // freshness up to +40
  if (NYC_RE.test(job.location || '')) s += 15;       // commutable
  if (job.remote) s += 8;
  if (EXACT_RE.test(job.title || '')) s += 10;        // best-fit titles
  return s;
}
module.exports = { matchesRole, matchesLocation, scoreJob };
```

- [ ] **Step 4: Run tests, verify pass** — `node jobs/filter.test.js` → ALL PASSED.

- [ ] **Step 5: Commit + push**

```bash
git add jobs/filter.js jobs/filter.test.js
git commit -m "feat(jobs): role/location match + scoring (TDD)"
git push origin develop
```

---

### Task 3: `jobs/ats.js` — Greenhouse/Lever/Ashby fetch + normalize (TDD w/ fixtures)

**Files:**
- Create: `jobs/ats.js`, `jobs/__fixtures__/{greenhouse,lever,ashby}.json` (trimmed real payloads)
- Test: `jobs/ats.test.js`

**Interfaces:**
- Produces: `normalizeGreenhouse(json)`, `normalizeLever(json)`, `normalizeAshby(json)` →
  `[{extId,title,location,remote,url,department,postedAt,description}]`; and async
  `fetchGreenhouse(token)`, `fetchLever(token)`, `fetchAshby(token)` (fetch + normalize).

- [ ] **Step 1: Save fixtures** — run and save trimmed real payloads (2–3 items each):

```bash
mkdir -p jobs/__fixtures__
curl -s "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs?content=true" > /tmp/gh.json
node -e "const j=require('/tmp/gh.json');require('fs').writeFileSync('jobs/__fixtures__/greenhouse.json',JSON.stringify({jobs:j.jobs.slice(0,3)},null,1))"
curl -s "https://api.lever.co/v0/postings/plaid?mode=json" > jobs/__fixtures__/lever.json   # array; if empty, use another Lever token
curl -s "https://api.ashbyhq.com/posting-api/job-board/ramp" > /tmp/ashby.json
node -e "const j=require('/tmp/ashby.json');require('fs').writeFileSync('jobs/__fixtures__/ashby.json',JSON.stringify({jobs:j.jobs.slice(0,3)},null,1))"
```

- [ ] **Step 2: Write the failing test `jobs/ats.test.js`:**

```js
const A = require('./ats');
let fail = 0; const ok = (c, l) => { console.log(c ? 'PASS' : 'FAIL', l); if (!c) fail++; };
const gh = A.normalizeGreenhouse(require('./__fixtures__/greenhouse.json'));
ok(gh.length >= 1 && gh[0].extId && gh[0].title && gh[0].url, 'greenhouse shape');
const lv = A.normalizeLever(require('./__fixtures__/lever.json'));
ok(Array.isArray(lv) && (lv.length === 0 || (lv[0].extId && lv[0].url)), 'lever shape');
const ash = A.normalizeAshby(require('./__fixtures__/ashby.json'));
ok(ash.length >= 1 && ash[0].extId && ash[0].title && ash[0].url, 'ashby shape');
ok(typeof gh[0].postedAt === 'string' || gh[0].postedAt === null, 'postedAt normalized');
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED'); process.exitCode = fail ? 1 : 0;
```

- [ ] **Step 3: Run it, verify it fails** — `node jobs/ats.test.js` → FAIL.

- [ ] **Step 4: Implement `jobs/ats.js`:**

```js
'use strict';
const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
const iso = (d) => { if (!d) return null; const t = typeof d === 'number' ? d : Date.parse(d); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

function normalizeGreenhouse(json) {
  return (json.jobs || []).map((j) => ({
    extId: String(j.id),
    title: j.title || '',
    location: (j.location && j.location.name) || '',
    remote: /remote/i.test((j.location && j.location.name) || ''),
    url: j.absolute_url,
    department: (j.departments && j.departments[0] && j.departments[0].name) || '',
    postedAt: iso(j.updated_at || j.first_published),
    description: stripHtml(j.content),
  })).filter((j) => j.extId && j.title && j.url);
}
function normalizeLever(json) {
  return (Array.isArray(json) ? json : []).map((j) => ({
    extId: String(j.id),
    title: j.text || '',
    location: (j.categories && j.categories.location) || '',
    remote: (j.workplaceType || '').toLowerCase() === 'remote' || /remote/i.test((j.categories && j.categories.location) || ''),
    url: j.hostedUrl || j.applyUrl,
    department: (j.categories && (j.categories.team || j.categories.department)) || '',
    postedAt: iso(j.createdAt),
    description: stripHtml(j.descriptionPlain || j.description),
  })).filter((j) => j.extId && j.title && j.url);
}
function normalizeAshby(json) {
  return (json.jobs || []).map((j) => ({
    extId: String(j.id),
    title: j.title || '',
    location: j.location || (j.address && j.address.postalAddress && j.address.postalAddress.addressLocality) || '',
    remote: !!j.isRemote,
    url: j.jobUrl || j.applyUrl,
    department: j.department || j.team || '',
    postedAt: iso(j.publishedAt),
    description: stripHtml(j.descriptionPlain || j.descriptionHtml),
  })).filter((j) => j.extId && j.title && j.url);
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'JobFlow/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const fetchGreenhouse = async (t) => normalizeGreenhouse(await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs?content=true`));
const fetchLever = async (t) => normalizeLever(await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`));
const fetchAshby = async (t) => normalizeAshby(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}`));
const FETCHERS = { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby };

module.exports = { normalizeGreenhouse, normalizeLever, normalizeAshby, fetchGreenhouse, fetchLever, fetchAshby, FETCHERS };
```

- [ ] **Step 5: Run tests, verify pass** — `node jobs/ats.test.js` → ALL PASSED.

- [ ] **Step 6: Commit + push**

```bash
git add jobs/ats.js jobs/ats.test.js jobs/__fixtures__/
git commit -m "feat(jobs): Greenhouse/Lever/Ashby fetch + normalize (TDD)"
git push origin develop
```

---

### Task 4: `jobs/detect.js` — detectAts(url) (TDD)

**Files:**
- Create: `jobs/detect.js`
- Test: `jobs/detect.test.js`

**Interfaces:**
- Produces: `detectFromHtml(html): {ats, token}|null` (pure), `detectAts(url): Promise<{ats,token}|null>`.

- [ ] **Step 1: Write the failing test `jobs/detect.test.js`:**

```js
const D = require('./detect');
let fail = 0; const eq = (g, w, l) => { console.log(JSON.stringify(g) === JSON.stringify(w) ? 'PASS' : 'FAIL', l, JSON.stringify(g)); if (JSON.stringify(g) !== JSON.stringify(w)) fail++; };
eq(D.detectFromHtml('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>'), { ats: 'greenhouse', token: 'acme' }, 'gh embed');
eq(D.detectFromHtml('<a href="https://job-boards.greenhouse.io/acme">Careers</a>'), { ats: 'greenhouse', token: 'acme' }, 'gh board');
eq(D.detectFromHtml('<iframe src="https://jobs.lever.co/foocorp"></iframe>'), { ats: 'lever', token: 'foocorp' }, 'lever');
eq(D.detectFromHtml('fetch("https://api.ashbyhq.com/posting-api/job-board/barinc")'), { ats: 'ashby', token: 'barinc' }, 'ashby');
eq(D.detectFromHtml('<h1>We use Workday</h1>'), null, 'none');
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED'); process.exitCode = fail ? 1 : 0;
```

- [ ] **Step 2: Run it, verify it fails** — `node jobs/detect.test.js` → FAIL.

- [ ] **Step 3: Implement `jobs/detect.js`:**

```js
'use strict';
const PATTERNS = [
  ['greenhouse', /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\/js\?for=|embed\/job_board\?for=)?([a-z0-9-]+)/i],
  ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9-]+)/i],
  ['lever', /jobs\.lever\.co\/([a-z0-9-]+)/i],
  ['lever', /api\.lever\.co\/v0\/postings\/([a-z0-9-]+)/i],
  ['ashby', /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i],
  ['ashby', /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9-]+)/i],
];
const BAD = /^(js|embed|v1|v0|api|www|for)$/i;
function detectFromHtml(html) {
  const h = html || '';
  for (const [ats, re] of PATTERNS) {
    const m = h.match(re);
    if (m && m[1] && !BAD.test(m[1])) return { ats, token: m[1] };
  }
  return null;
}
async function detectAts(url) {
  try {
    const u = /^https?:/i.test(url) ? url : 'https://' + url;
    const r = await fetch(u, { signal: AbortSignal.timeout(12000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 JobFlow' } });
    const html = await r.text();
    // also try a /careers path if the root had nothing
    let hit = detectFromHtml(html) || detectFromHtml(r.url);
    if (!hit) {
      try {
        const cr = await fetch(new URL('/careers', u).href, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 JobFlow' } });
        hit = detectFromHtml(await cr.text());
      } catch (e) {}
    }
    return hit;
  } catch (e) { return null; }
}
module.exports = { detectFromHtml, detectAts };
```

- [ ] **Step 4: Run tests, verify pass** — `node jobs/detect.test.js` → ALL PASSED.

- [ ] **Step 5: Commit + push**

```bash
git add jobs/detect.js jobs/detect.test.js
git commit -m "feat(jobs): ATS auto-detection from a careers URL (TDD)"
git push origin develop
```

---

### Task 5: seed list + `jobs/seed.js` (seedCompanies, importYc)

**Files:**
- Create: `jobs/seed-companies.json`, `jobs/verify-seed.js` (build-time check), `jobs/seed.js`

**Interfaces:**
- Consumes: `ats.FETCHERS`, `detect.detectAts`, `db.query`.
- Produces: `seedCompanies(): Promise<{added}>`, `importYc({limit,offset}): Promise<{scanned,added}>`,
  `addCompany({url}|{name,ats,token}): Promise<company|{error}>`.

- [ ] **Step 1: Compile + verify the seed** — assemble a candidate list of data-heavy companies with
  guessed `{name, ats, token}` (Greenhouse: airbnb, databricks, coinbase, robinhood, brex, gusto,
  affirm, instacart, doordash, dropbox, reddit, wayfair; Lever/Ashby similar), then keep only tokens
  that return ≥1 job. Write `jobs/verify-seed.js`:

```js
const { FETCHERS } = require('./ats');
(async () => {
  const cand = require('./seed-candidates.json'); // [{name,ats,token}]
  const good = [];
  for (const c of cand) {
    try { const n = (await FETCHERS[c.ats](c.token)).length; if (n > 0) { good.push(c); console.log('OK', c.ats, c.token, n); } else console.log('empty', c.token); }
    catch (e) { console.log('DEAD', c.ats, c.token, e.message); }
  }
  require('fs').writeFileSync(__dirname + '/seed-companies.json', JSON.stringify(good, null, 1));
  console.log('kept', good.length);
})();
```
  Create `jobs/seed-candidates.json` with the candidates, run `node jobs/verify-seed.js`, and commit
  the resulting `seed-companies.json` (verified, ~50–80 entries).

- [ ] **Step 2: Implement `jobs/seed.js`:**

```js
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

// Paste a careers URL (or name+ats+token) → register it.
async function addCompany(input) {
  if (input.ats && input.token) return upsertCompany({ ...input, source: 'manual' });
  if (!input.url) return { error: 'need a url or {name,ats,token}' };
  const hit = await detectAts(input.url);
  if (!hit) return { error: 'No Greenhouse/Lever/Ashby board found at that URL (likely Workday/Oracle — Phase 2).' };
  return upsertCompany({ name: input.name || hit.token, ats: hit.ats, token: hit.token, website: input.url, source: 'manual' });
}

// Bounded YC import: fetch the directory, detect ATS on each website, register hits. Resumable.
async function importYc({ limit = 100, offset = 0 } = {}) {
  const all = await (await fetch('https://yc-oss.github.io/api/companies/all.json', { signal: AbortSignal.timeout(20000) })).json();
  const slice = all.slice(offset, offset + limit).filter((c) => c.website);
  let scanned = 0, added = 0;
  for (const c of slice) {
    scanned++;
    try {
      const exists = (await query('SELECT 1 FROM companies WHERE website = $1 LIMIT 1', [c.website])).rowCount;
      if (exists) continue;
      const hit = await detectAts(c.website);
      if (hit) { await upsertCompany({ name: c.name, ats: hit.ats, token: hit.token, website: c.website, source: 'yc' }); added++; }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 200)); // politeness
  }
  return { scanned, added, nextOffset: offset + limit, total: all.length };
}
module.exports = { seedCompanies, addCompany, importYc, upsertCompany };
```

- [ ] **Step 3: Verify** — `node -e "require('./jobs/seed').seedCompanies().then(r=>{console.log(r);process.exit(0)})"`
  then `psql -c "select count(*) from companies"` shows the seed count.

- [ ] **Step 4: Commit + push**

```bash
git add jobs/seed.js jobs/seed-candidates.json jobs/seed-companies.json jobs/verify-seed.js
git commit -m "feat(jobs): verified seed list + registry upsert, add-by-URL, YC import"
git push origin develop
```

---

### Task 6: `jobs/pull.js` — pullCompany + pullAll (upsert/dedupe)

**Files:**
- Create: `jobs/pull.js`

**Interfaces:**
- Consumes: `ats.FETCHERS`, `filter.*`, `db.query`.
- Produces: `pullCompany(company): Promise<{inserted,updated}>`, `pullAll(): Promise<summary>`, `isRunning(): boolean`.

- [ ] **Step 1: Implement `jobs/pull.js`:**

```js
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
  catch (e) { await query('UPDATE companies SET last_error=$2, last_pulled=NOW() WHERE id=$1', [c.id, e.message]); return { inserted: 0, updated: 0, error: e.message }; }
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
```

- [ ] **Step 2: Verify (integration, manual)** — after seeding:
  `node -e "require('./jobs/pull').pullAll().then(r=>{console.log(r);process.exit(0)})"`
  Expected: `{companies: N, inserted: >0, …}`; `psql -c "select count(*) from jobs where active"` > 0.

- [ ] **Step 3: Commit + push**

```bash
git add jobs/pull.js
git commit -m "feat(jobs): daily pull — fetch, filter, upsert/dedupe, delist gone postings"
git push origin develop
```

---

### Task 7: `routes/jobs.js` API + mount + in-process scheduler

**Files:**
- Create: `routes/jobs.js`
- Modify: `server.js` (mount route + scheduler)

**Interfaces:**
- Produces: `GET /api/jobs`, `POST /api/jobs/refresh`, `GET/POST/DELETE /api/companies`,
  `POST /api/companies/seed`, `POST /api/companies/import-yc`.

- [ ] **Step 1: Implement `routes/jobs.js`:**

```js
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
    const params = [days];
    let where = `active = TRUE AND (posted_at IS NULL OR posted_at > NOW() - ($1 || ' days')::interval)`;
    if (q) { params.push('%' + q + '%'); where += ` AND (title ILIKE $${params.length} OR company ILIKE $${params.length})`; }
    if (req.query.new === '1') where += ` AND first_seen::date = CURRENT_DATE`;
    const rows = (await query(`SELECT id,company,ats,title,location,remote,url,department,posted_at,score,first_seen,
      (first_seen::date = CURRENT_DATE) AS is_new FROM jobs WHERE ${where} ORDER BY ${sort} LIMIT 500`, params)).rows;
    const totals = (await query('SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE first_seen::date=CURRENT_DATE)::int new_today FROM jobs WHERE active=TRUE')).rows[0];
    res.json({ jobs: rows, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/refresh', async (req, res) => {
  if (isRunning()) return res.json({ running: true, message: 'A pull is already in progress.' });
  pullAll().then((r) => console.log('[jobs] refresh', JSON.stringify(r))).catch((e) => console.warn('[jobs] refresh failed', e.message));
  res.json({ started: true });
});

router.get('/companies', async (req, res) => {
  const rows = (await query('SELECT id,name,ats,token,source,active,last_pulled,last_error,(SELECT COUNT(*)::int FROM jobs j WHERE j.company_id=c.id AND j.active) AS jobs FROM companies c ORDER BY name')).rows;
  res.json({ companies: rows });
});
router.post('/companies', async (req, res) => {
  const r = await addCompany(req.body || {});
  if (r && r.error) return res.status(400).json(r);
  res.json({ company: r });
});
router.delete('/companies/:id', async (req, res) => { await query('DELETE FROM companies WHERE id=$1', [req.params.id]); res.json({ ok: true }); });
router.post('/companies/seed', async (req, res) => { res.json(await seedCompanies()); });
router.post('/companies/import-yc', async (req, res) => {
  try { res.json(await importYc({ limit: Math.min(parseInt(req.body && req.body.limit) || 100, 300), offset: parseInt(req.body && req.body.offset) || 0 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
```

- [ ] **Step 2: Mount + scheduler in `server.js`** — add after the other `app.use('/api/...')` lines:

```js
app.use('/api/jobs', require('./routes/jobs'));
```
  and after `ensureJobsTables()` resolves, start the scheduler:

```js
const { pullAll } = require('./jobs/pull');
async function maybePull() {
  try {
    const r = await require('./db').query('SELECT MAX(last_pulled) AS last FROM companies');
    const last = r.rows[0].last ? new Date(r.rows[0].last).getTime() : 0;
    if (Date.now() - last > 20 * 3600 * 1000) { console.log('[jobs] daily pull starting…'); pullAll().then((x) => console.log('[jobs] pull done', JSON.stringify(x))); }
  } catch (e) { console.warn('[jobs] scheduler:', e.message); }
}
require('./jobs/db').ensureJobsTables().then(() => { maybePull(); setInterval(maybePull, 6 * 3600 * 1000); });
```
  (Replace the Task-1 boot snippet with this combined version.)

- [ ] **Step 3: Verify via curl** — start the server, then:

```bash
curl -s -X POST localhost:3000/api/companies/seed
curl -s -X POST localhost:3000/api/jobs/refresh    # then wait ~30s
curl -s "localhost:3000/api/jobs?sort=new" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('jobs',j.jobs.length,'new_today',j.totals.new_today,'e.g.',j.jobs[0]&&j.jobs[0].title,'@',j.jobs[0]&&j.jobs[0].company)})"
```
  Expected: a non-empty list of DE/analytics jobs with companies.

- [ ] **Step 4: Commit + push**

```bash
git add routes/jobs.js server.js
git commit -m "feat(jobs): /api/jobs + /api/companies API and in-process daily pull"
git push origin develop
```

---

### Task 8: Find Jobs UI (DB-backed) + Companies manager

**Files:**
- Modify: `index.html` (Find Jobs section + JS)

**Interfaces:**
- Consumes: `GET /api/jobs`, `POST /api/jobs/refresh`, `/api/companies*`.

- [ ] **Step 1: Repoint the feed** — replace the primary client-side `srcs` fetch (the Remotive/
  Arbeitnow/RemoteOK block around `index.html:853`) so the main list comes from
  `GET /api/jobs?days=&q=&sort=`. Render cards: title, company, location, posted date, a green **NEW**
  badge when `is_new`, score-ranked; "Apply" opens `job.url` in a new tab (ATS posting → ⚡ fills it).
  Keep the old boards behind an "Also search remote boards" checkbox that appends their results.

- [ ] **Step 2: Controls** — a role/keyword search box (default empty = all DE/analytics), a freshness
  `<select>` (7/14/30/45 days), sort toggle (Best match / Newest), and a **Refresh now** button that
  `POST /api/jobs/refresh`, shows "pulling…", then re-loads after ~20s. Show `totals.new_today`.

- [ ] **Step 3: Companies manager** — a collapsible panel: lists `/api/jobs/companies` (name, ats,
  active job count, last_pulled, last_error), an **Add company** input (paste careers URL →
  `POST /api/companies {url}`, show detected ats/token or the error), a **Seed** button
  (`POST /api/companies/seed`), and an **Import YC** button (`POST /api/companies/import-yc {limit:100, offset}`)
  that shows `scanned/added` and advances `offset` on repeat clicks. Delete via `DELETE /api/companies/:id`.

- [ ] **Step 4: Verify (manual, real app)** — `npm start`, open localhost:3000 → Find Jobs: click
  Seed, Refresh now, confirm ranked DE/analytics jobs appear with NEW badges and NYC-metro ranked
  high; open one → the ATS page loads and ⚡ fills it. Add a company by URL; Import YC adds a few.

- [ ] **Step 5: Commit + push**

```bash
git add index.html
git commit -m "feat(ui): Find Jobs from the ATS job DB — ranked, new-today, companies manager"
git push origin develop
```

---

## Self-Review

**Spec coverage:** tables (T1) ✓; role/location/score (T2) ✓; GH/Lever/Ashby fetch+normalize (T3) ✓;
add-by-URL detection (T4) ✓; verified seed + YC import (T5) ✓; daily pull/dedupe/delist (T6) ✓; API +
in-process scheduler (T7) ✓; UI + companies manager (T8) ✓. US/Remote-US + NYC ranking (T2) ✓; no
sponsorship filter ✓; no new deps ✓.

**Placeholder scan:** All modules have complete code. T5-step1 requires assembling `seed-candidates.json`
by hand (real company tokens) then the verify script prunes it — this is data entry, not a code gap.
T8 gives exact endpoints/behavior + the anchor line to replace; the card HTML is written at execution
(vanilla DOM, following the existing Find Jobs render) — no new decisions.

**Type/name consistency:** normalized job shape `{extId,title,location,remote,url,department,postedAt,description}`
is identical across `ats.js`, `pull.js`, `scoreJob`; `matchesRole/matchesLocation/scoreJob`,
`FETCHERS`, `pullAll/pullCompany/isRunning`, `seedCompanies/addCompany/importYc/upsertCompany`,
`ensureJobsTables` — all names match across tasks and routes.
