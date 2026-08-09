# Design — ATS Job Source (Phase 1)

Date: 2026-08-08
Status: Approved phasing (pending spec review)
Area: Node/Express backend (`routes/`, new `jobs/` module, `db/`), `index.html` Find Jobs

## Problem

JobFlow's Find Jobs pulls only remote-aggregator feeds (Remotive, Arbeitnow, RemoteOK, optional
Adzuna) — a thin, self-selected slice. LinkedIn/Indeed can't be scraped (ToS + anti-bot; Indeed
killed its API). The high-signal, legal source is the **ATS public job boards** (Greenhouse, Lever,
Ashby), which also happen to be the platforms the ⚡ autofill already handles — so every job found is
one-click applyable. Verified live: Greenhouse `airbnb` → 189 jobs, Ashby `ramp` → 122 jobs, Lever
returns clean JSON per company; YC directory (`yc-oss.github.io/api`) lists 6,135 companies with websites.

## Goals (Phase 1)

1. Pull DE / Data Analyst / Analytics Engineer roles from **Greenhouse + Lever + Ashby**, per company.
2. A **company registry** seeded three ways: a curated list (verified tokens), **add-by-URL**
   (paste a careers page → auto-detect ATS + token), and **YC directory import** (name+website → detect).
3. **Daily pull** into Postgres, dedupe, flag "new today", filter to the target roles + US/Remote-US,
   rank NYC-metro higher.
4. Find Jobs UI loads instantly from the DB; each job links to apply (⚡-applyable).

## Non-goals (Phase 2, explicitly deferred)

- S&P 500 / enterprise coverage, **Workday / Oracle / iCIMS** fetchers.
- Name→careers-URL discovery via a paid search API (SerpAPI/Bing).
- Sponsorship scanning (decided: show all, user judges).

## Constraints / decisions

- Location scope: **US + Remote-US**; NYC-metro ranked higher (not required).
- Sponsorship: **not filtered** in Phase 1.
- No new npm deps — Node 24 global `fetch`; scheduler is in-process.
- Server-side fetching (no browser CORS); the API key-free ATS endpoints need no secrets.

## Data model (new migration, additive — no changes to existing tables)

```sql
CREATE TABLE IF NOT EXISTS companies (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  ats         TEXT NOT NULL,              -- 'greenhouse' | 'lever' | 'ashby'
  token       TEXT NOT NULL,              -- board token / company slug
  website     TEXT,
  source      TEXT DEFAULT 'manual',      -- 'seed' | 'yc' | 'manual'
  active      BOOLEAN DEFAULT TRUE,
  last_pulled TIMESTAMPTZ,
  last_error  TEXT,
  added_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ats, token)
);

CREATE TABLE IF NOT EXISTS jobs (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  company     TEXT NOT NULL,
  ats         TEXT NOT NULL,
  ext_id      TEXT NOT NULL,              -- ATS job id (dedupe key)
  title       TEXT NOT NULL,
  location    TEXT,
  remote      BOOLEAN DEFAULT FALSE,
  url         TEXT NOT NULL,
  department  TEXT,
  posted_at   TIMESTAMPTZ,
  score       INTEGER DEFAULT 0,
  description TEXT,
  first_seen  TIMESTAMPTZ DEFAULT NOW(),
  last_seen   TIMESTAMPTZ DEFAULT NOW(),
  active      BOOLEAN DEFAULT TRUE,
  UNIQUE (ats, ext_id)
);
CREATE INDEX IF NOT EXISTS jobs_posted_idx ON jobs (posted_at DESC);
CREATE INDEX IF NOT EXISTS jobs_active_idx ON jobs (active, first_seen DESC);
```

Ships in `db/schema.sql` and applied idempotently on boot (matches the existing pattern in `db/init.js`).

## Components

### `jobs/ats.js` — per-ATS fetchers (pure fetch + normalize)
Each returns a normalized array `{extId, title, location, remote, url, department, postedAt, description}`.
- `fetchGreenhouse(token)` → `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`
  (`content=true` returns descriptions). Fields: `id`, `title`, `location.name`, `absolute_url`,
  `updated_at`, `departments[].name`, `content`.
- `fetchLever(token)` → `GET api.lever.co/v0/postings/{token}?mode=json`. Fields: `id`, `text`,
  `categories.location`/`.commitment`, `hostedUrl`, `createdAt`, `categories.team`, `descriptionPlain`.
  `workplaceType==='remote'` → remote.
- `fetchAshby(token)` → `GET api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=false`.
  Fields: `jobs[].id`, `.title`, `.location`, `.isRemote`, `.jobUrl`/`applyUrl`, `.publishedAt`,
  `.department`, `.descriptionPlain`.
- Each wrapped in try/catch with a short timeout; a bad company never aborts the batch (records `last_error`).

### `jobs/detect.js` — `detectAts(url)` → `{ats, token} | null`
Fetch the page HTML (follow redirects) and match, in order:
- `boards?.greenhouse.io/(?:embed/job_board\?for=)?([\w-]+)` and `job-boards.greenhouse.io/([\w-]+)`
- `jobs.lever.co/([\w-]+)` and `api.lever.co/v0/postings/([\w-]+)`
- `jobs.ashbyhq.com/([\w-]+)` and `api.ashbyhq.com/posting-api/job-board/([\w-]+)`
Also checks embedded script srcs / JSON. Returns the first hit; `null` if none (likely Workday/Oracle → Phase 2).

### `jobs/filter.js` — role/location match + score
- `matchesRole(title)` — `/data engineer|data analyst|analytics engineer|\banalytics\b|business intelligence|\bbi\b|data (platform|warehouse|scientist)|\betl\b|\bdbt\b|data infrastructure/i`.
- `matchesLocation(loc, remote)` — accept if `remote` (treated as US-remote unless the text names a
  non-US region), or `loc` matches a US state/abbrev/"United States"/"USA"/major US city; reject
  clearly non-US (`/india|london|uk|emea|canada|remote - (emea|apac|europe)/i`) when not US-remote.
- `score(job)` — freshness (days since `postedAt`, newer = higher) + NYC-metro boost
  (`/new york|nyc|jersey|newark|hoboken|new jersey|\bny\b|\bnj\b/i`) + exact-title boost
  ("data engineer"/"analytics engineer") + remote boost. Used for default ranking.

### `jobs/pull.js` — orchestration
- `pullCompany(company)` — fetch via the right ATS fn, `matchesRole` + `matchesLocation`, compute
  `score`, **upsert** into `jobs` on `(ats, ext_id)`: insert sets `first_seen=now`; existing rows
  update `last_seen`, `title/location/score`, keep `first_seen`. Mark company `last_pulled`.
- `pullAll()` — iterate active companies with a small concurrency limit (e.g. 5) and politeness delay;
  after the run, set `active=false` on jobs whose `last_seen` predates this run for their company
  (delisted). Returns `{companies, fetched, inserted, updated, deactivated}`.

### `jobs/seed.js` — registry bootstrap
- `SEED` — curated JSON of ~50–80 data-heavy companies `{name, ats, token}`, **each verified during
  the build to actually return jobs** (a script hits every token once and drops dead ones), shipped in
  `jobs/seed-companies.json`. `seedCompanies()` upserts them (`source='seed'`). YC import provides scale
  beyond the seed; the seed just guarantees immediate value on first run.
- `importYc({limit, offset})` — fetch the YC directory JSON, for each company run `detectAts(website)`
  with bounded concurrency + caching (skip already-registered or already-tried), register resolved
  ones (`source='yc'`). On-demand and resumable (offset), so it never blocks or hammers.

### `routes/jobs.js` — API
- `GET /api/jobs?role=&loc=&days=&q=&sort=` — list from `jobs` (active), default sort by `score`
  then `first_seen`; supports `new=1` (first_seen today). Returns rows + counts.
- `POST /api/jobs/refresh` — run `pullAll()` (guarded so two runs don't overlap); returns summary.
- `GET /api/companies` / `POST /api/companies` (`{url}` → detect+add, or `{name,ats,token}`) /
  `DELETE /api/companies/:id` / `PATCH` to toggle `active`.
- `POST /api/companies/seed` — run `seedCompanies()`. `POST /api/companies/import-yc` — run `importYc`.

### Scheduler (in `server.js`)
On boot: if the newest `companies.last_pulled` is > 20h old (or `jobs` empty), kick `pullAll()` in the
background. Plus a `setInterval` every 6h that runs `pullAll()` when the last pull is > 20h old — a
daily cadence while the server runs, no cron dependency. All wrapped so a failure never crashes boot.

### UI — `index.html` Find Jobs
- Primary feed now calls `GET /api/jobs` (DB-backed): cards with title, company, location, posted date,
  a **NEW** badge (first_seen today), score-ranked, "Apply" link (opens the ATS posting → ⚡ fills it).
- Controls: role preset (default the three titles), location filter, freshness (days), text search,
  sort (best match / newest), "Refresh now" (calls `/api/jobs/refresh`), and a **Companies** manager
  (list, add-by-URL, remove, seed, import-YC with progress).
- The old remote-board sources remain behind an optional "Also search remote boards" toggle
  (supplementary, client-side, unchanged) so nothing is lost.

## Data flow

```
seed-companies.json ─┐
YC directory + detect ├─► companies (registry)
add-by-URL (detect) ──┘
        │  pullAll() daily (in-process) / POST /api/jobs/refresh
        ▼
  Greenhouse/Lever/Ashby fetchers → matchesRole+matchesLocation+score → UPSERT jobs (dedupe ext_id)
        │
   GET /api/jobs  ─►  Find Jobs UI (ranked, "new today", Apply → ⚡)
```

## Error handling
- Per-company fetch failures recorded in `companies.last_error`; never abort the batch.
- `detectAts` returning null → not added; surfaced to the user as "couldn't detect an ATS (likely
  Workday/Oracle — Phase 2)".
- `pullAll` guarded by an in-memory `running` flag; `/api/jobs/refresh` returns "already running" if so.
- All network calls time-boxed; malformed JSON tolerated (empty result, logged).

## Testing
- **Unit (`jobs/*` are pure/mockable):** `filter.js` — `matchesRole` (DE/analyst/analytics eng in,
  "Sales Analyst"/"Financial Analyst" borderline handled, unrelated out), `matchesLocation`
  (US/remote in, London/India out unless US-remote), `score` ordering (NYC/newer/exact-title rank
  higher). `ats.js` normalizers against captured sample payloads (one saved JSON per ATS in
  `jobs/__fixtures__/`). `detect.js` against saved careers-page HTML snippets for each ATS.
- **Integration:** a live `pullCompany` for one known Greenhouse token against a throwaway DB row,
  asserting a jobs upsert (guarded behind a flag / run manually so CI stays offline-safe).
- **Manual:** `POST /api/companies/seed` → `POST /api/jobs/refresh` → `GET /api/jobs` returns ranked
  DE/analytics jobs; open one → ⚡ fills it.

## Rollout
Additive migration; seed shipped; UI feature-flagged only in that the remote boards move behind a
toggle. Commit + push per unit on `develop`. No extension version bump (server/UI only).
