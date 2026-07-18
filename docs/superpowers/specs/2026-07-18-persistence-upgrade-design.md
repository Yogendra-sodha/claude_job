# JobFlow Persistence Upgrade — Design Specification

**Date:** 2026-07-18  
**Status:** Approved by user  
**Approach:** A — Node.js backend + PostgreSQL + Extension API

---

## Problem

JobFlow is a single `index.html` file opened via `file://` protocol. All data lives in `localStorage`, which is:
1. **Fragile** — tied to exact file path, cleared by browser cleanup, lost across profiles
2. **Isolated** — the Chrome extension cannot access the main app's localStorage, requiring manual copy/paste of profile JSON
3. **Not portable** — no backup beyond manual JSON export

The user wants a Jobright-like experience: fill profile once, never lose it, extension auto-fills job applications without any manual data transfer.

---

## Solution Architecture

```
┌─────────────────────────────────────────────────────┐
│                  User's Machine                       │
│                                                       │
│  ┌──────────────┐    ┌──────────────┐                │
│  │ Chrome Browser│    │ Chrome       │                │
│  │ localhost:3000│    │ Extension    │                │
│  │ (JobFlow UI) │    │ (Autofill)   │                │
│  └──────┬───────┘    └──────┬───────┘                │
│         │ fetch()           │ fetch()                 │
│         ▼                   ▼                         │
│  ┌────────────────────────────────┐                   │
│  │  Node.js Express Server       │                   │
│  │  http://localhost:3000        │                   │
│  │                                │                   │
│  │  GET/POST /api/profile        │                   │
│  │  GET/POST/PUT/DELETE /api/apps│                   │
│  │  GET/POST /api/settings       │                   │
│  │  GET /api/extension-data      │                   │
│  │  (serves index.html)          │                   │
│  └──────────┬─────────────────────┘                   │
│             │                                         │
│             ▼                                         │
│  ┌────────────────────────┐                           │
│  │  PostgreSQL 18         │                           │
│  │  Database: jobflow     │                           │
│  │  Tables:               │                           │
│  │   - profiles           │                           │
│  │   - applications       │                           │
│  │   - contacts           │                           │
│  │   - materials          │                           │
│  │   - settings           │                           │
│  └────────────────────────┘                           │
│                                                       │
│  start-jobflow.bat → starts server + opens browser    │
└─────────────────────────────────────────────────────┘
```

---

## Database Schema

### `profiles` (single-row, upserted)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | Always row 1 |
| name | TEXT | |
| title | TEXT | Target job title |
| email | TEXT | |
| phone | TEXT | |
| location | TEXT | |
| linkedin | TEXT | |
| portfolio | TEXT | |
| years | TEXT | |
| summary | TEXT | |
| skills | TEXT | |
| experience | TEXT | |
| education | TEXT | |
| updated_at | TIMESTAMPTZ | Auto-updated |

### `applications`
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| company | TEXT | |
| role | TEXT | |
| status | TEXT | saved/applied/referral/interview/offer/rejected |
| referral | TEXT | no/sent/got |
| applied | DATE | |
| followup | DATE | |
| notes | TEXT | |
| jd | TEXT | Job description (up to 5000 chars) |
| created_at | TIMESTAMPTZ | |

### `contacts` (per application)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| app_id | INT REFERENCES applications(id) ON DELETE CASCADE | |
| name | TEXT | |
| url | TEXT | LinkedIn URL |
| status | TEXT | to-message/messaged/replied/referred/declined |
| messaged | DATE | |
| added | DATE | |

### `materials` (per application)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| app_id | INT REFERENCES applications(id) ON DELETE CASCADE | |
| kind | TEXT | cover/resume/referral/recruiter/followup |
| content | TEXT | Up to 20000 chars |
| created_at | DATE | |

### `settings` (single-row, upserted)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | Always row 1 |
| mode | TEXT | manual/openai |
| api_key | TEXT | Encrypted at rest |
| model | TEXT | gpt-4o-mini/gpt-4o |
| adzuna_country | TEXT | |
| adzuna_where | TEXT | |
| adzuna_id | TEXT | |
| adzuna_key | TEXT | |

---

## API Endpoints

All endpoints return JSON. CORS enabled for extension access.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profile` | Get profile (single row) |
| PUT | `/api/profile` | Upsert profile |
| GET | `/api/apps` | List all applications |
| POST | `/api/apps` | Create application |
| PUT | `/api/apps/:id` | Update application |
| DELETE | `/api/apps/:id` | Delete application |
| GET | `/api/apps/:id/contacts` | List contacts for an app |
| POST | `/api/apps/:id/contacts` | Add contact |
| PUT | `/api/contacts/:id` | Update contact |
| DELETE | `/api/contacts/:id` | Delete contact |
| GET | `/api/apps/:id/materials` | List materials for an app |
| POST | `/api/apps/:id/materials` | Add material |
| DELETE | `/api/materials/:id` | Delete material |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Upsert settings |
| GET | `/api/extension-data` | Combined: profile + settings + latest cover letter for extension |
| POST | `/api/data/export` | Export all data as JSON |
| POST | `/api/data/import` | Import data from JSON |
| DELETE | `/api/data/wipe` | Wipe all data |

---

## Extension v2 Design

### Changes from v1
1. **No more manual copy/paste** — extension fetches profile from `http://localhost:3000/api/extension-data`
2. **Content script** injects a floating "⚡ JobFlow" button on all pages
3. **Smarter field matching** — handles Workday `data-automation-id`, Greenhouse, Lever, and generic forms
4. **Work history filling** — parses experience from profile, fills employment history sections
5. **Cover letter** — fetches the latest generated cover letter from the API

### Manifest v3 Updates
- Add `content_scripts` for all URLs
- Add `http://localhost:3000/*` to `host_permissions`
- Content script: `content.js` (floating button + fill logic)
- Popup remains for status/config

### Floating Button UX
- Small pill button: "⚡ JobFlow" in bottom-right corner
- Click → fills all detected fields
- Shows toast: "Filled 12 fields ✓" or "No fields detected"
- Draggable so user can reposition
- Badge shows field count detected

---

## Frontend Migration (index.html)

The HTML/CSS structure stays identical. Only the JavaScript changes:
- Replace all `store.get()` / `store.set()` calls with `fetch()` to API
- Add async/await wrappers
- Keep localStorage as a **fallback cache** for offline use
- On page load: fetch from API → populate UI (if API unreachable, fall back to localStorage)

---

## Startup Script

`start-jobflow.bat`:
```batch
@echo off
cd /d "%~dp0"
start /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start http://localhost:3000
```

Also create `start-jobflow.ps1` for PowerShell users.

---

## Data Migration

On first server start:
1. Check if PostgreSQL `jobflow` database exists → create if not
2. Run schema migrations
3. Check if localStorage has data (via a one-time migration endpoint) → offer to import

On the frontend, if the API returns empty profile but localStorage has data, show a "migrate" button.

---

## Security Notes
- Server listens on `127.0.0.1` only (not exposed to network)
- API key stored encrypted in PostgreSQL (simple AES with machine-specific key)
- No authentication needed (local-only server)
- CORS allows only `chrome-extension://*` and `http://localhost:3000`
