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
  model TEXT DEFAULT 'gpt-4o-mini',
  adzuna_country TEXT DEFAULT 'us',
  adzuna_where TEXT DEFAULT '',
  adzuna_id TEXT DEFAULT '',
  adzuna_key TEXT DEFAULT ''
);

-- Ensure exactly one settings row exists
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_contacts_app_id ON contacts(app_id);
CREATE INDEX IF NOT EXISTS idx_materials_app_id ON materials(app_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
