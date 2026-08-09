-- JobFlow PostgreSQL Schema
-- Run once: node db/init.js

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name TEXT DEFAULT '',
  title TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  location TEXT DEFAULT '',
  linkedin TEXT DEFAULT '',
  portfolio TEXT DEFAULT '',
  years TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  experience TEXT DEFAULT '',
  education TEXT DEFAULT '',
  demographics TEXT DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure exactly one profile row exists
INSERT INTO profiles (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  company TEXT DEFAULT '',
  role TEXT DEFAULT '',
  status TEXT DEFAULT 'saved',
  referral TEXT DEFAULT 'no',
  applied DATE,
  followup DATE,
  notes TEXT DEFAULT '',
  jd TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name TEXT DEFAULT '',
  url TEXT DEFAULT '',
  status TEXT DEFAULT 'to-message',
  messaged DATE,
  added DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT DEFAULT '',
  content TEXT DEFAULT '',
  created_at DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode TEXT DEFAULT 'manual',
  api_key TEXT DEFAULT '',
  model TEXT DEFAULT 'gpt-5',
  api_base TEXT DEFAULT 'https://api.openai.com/v1',
  adzuna_country TEXT DEFAULT 'us',
  adzuna_where TEXT DEFAULT '',
  adzuna_id TEXT DEFAULT '',
  adzuna_key TEXT DEFAULT ''
);

-- Ensure exactly one settings row exists
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Migration for existing databases: provider base URL for the AI autofill
ALTER TABLE settings ADD COLUMN IF NOT EXISTS api_base TEXT DEFAULT 'https://api.openai.com/v1';

-- Every AI autofill request/response, with token accounting (never stores the API key)
CREATE TABLE IF NOT EXISTS ai_requests (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  stage TEXT DEFAULT '',
  model TEXT DEFAULT '',
  base TEXT DEFAULT '',
  questions JSONB,
  prompt TEXT DEFAULT '',
  raw_reply TEXT DEFAULT '',
  answers JSONB,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  error TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_created ON ai_requests(created_at DESC);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_contacts_app_id ON contacts(app_id);
CREATE INDEX IF NOT EXISTS idx_materials_app_id ON materials(app_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

-- =====================================================================
-- Job sourcing (ATS boards): company registry + pulled jobs
-- =====================================================================
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
