# Persistence Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform JobFlow from a localStorage-based static HTML file into a full-stack local app with PostgreSQL persistence and a seamless Chrome extension.

**Architecture:** Express.js server on localhost:3000 serves the frontend and REST API. PostgreSQL stores all data. Chrome extension fetches profile from the API and injects a floating autofill button.

**Tech Stack:** Node.js 24, Express.js, pg (node-postgres), PostgreSQL 18, Chrome Extension Manifest V3

## Global Constraints
- Server MUST listen on 127.0.0.1 only (security)
- All existing UI/CSS/UX must remain unchanged
- Commit + push after every task
- Validate JS parses + server starts before each commit
- PostgreSQL user: `postgres` (user's existing install)

---

### Task 1: Backend Scaffolding
**Files:**
- Create: `package.json`
- Create: `server.js`
- Create: `db.js`
- Create: `db/schema.sql`
- Create: `db/init.js`
- Create: `.env.example`
- Create: `.gitignore` (update)

- [ ] Step 1: Create package.json with dependencies
- [ ] Step 2: Create db/schema.sql with all tables
- [ ] Step 3: Create db.js (PostgreSQL connection pool)
- [ ] Step 4: Create db/init.js (database + table creation script)
- [ ] Step 5: Create server.js (Express server, serves index.html, CORS)
- [ ] Step 6: Update .gitignore (node_modules, .env)
- [ ] Step 7: npm install
- [ ] Step 8: Test: database init + server starts
- [ ] Step 9: Commit + push

### Task 2: API Routes — Profile & Settings
**Files:**
- Create: `routes/profile.js`
- Create: `routes/settings.js`

- [ ] Step 1: Create routes/profile.js (GET, PUT)
- [ ] Step 2: Create routes/settings.js (GET, PUT)
- [ ] Step 3: Wire routes into server.js
- [ ] Step 4: Test endpoints with curl/fetch
- [ ] Step 5: Commit + push

### Task 3: API Routes — Applications, Contacts, Materials
**Files:**
- Create: `routes/apps.js`
- Create: `routes/contacts.js`
- Create: `routes/materials.js`

- [ ] Step 1: Create routes/apps.js (GET list, POST, PUT, DELETE)
- [ ] Step 2: Create routes/contacts.js (GET, POST, PUT, DELETE)
- [ ] Step 3: Create routes/materials.js (GET, POST, DELETE)
- [ ] Step 4: Wire routes into server.js
- [ ] Step 5: Test endpoints
- [ ] Step 6: Commit + push

### Task 4: Data Management Routes
**Files:**
- Create: `routes/data.js`

- [ ] Step 1: Create routes/data.js (export, import, wipe, extension-data)
- [ ] Step 2: Wire into server.js
- [ ] Step 3: Test export/import cycle
- [ ] Step 4: Commit + push

### Task 5: Migrate index.html — Replace localStorage with API
**Files:**
- Modify: `index.html` (JavaScript section only)

- [ ] Step 1: Replace store.get/store.set with async API wrapper functions
- [ ] Step 2: Update profile save/load to use API
- [ ] Step 3: Update tracker to use API
- [ ] Step 4: Update settings to use API
- [ ] Step 5: Update generate/outreach/feed to use API
- [ ] Step 6: Update data management (export/import/wipe) to use API
- [ ] Step 7: Add localStorage migration prompt (if API empty but localStorage has data)
- [ ] Step 8: Validate: node -e parse check
- [ ] Step 9: Test in browser: all tabs work
- [ ] Step 10: Commit + push

### Task 6: Extension v2 — Floating Button + API-backed
**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Create: `extension/content.js`
- Create: `extension/content.css`

- [ ] Step 1: Update manifest.json (content_scripts, host_permissions)
- [ ] Step 2: Create content.css (floating button styles)
- [ ] Step 3: Create content.js (floating button, API fetch, smart fill with work history)
- [ ] Step 4: Update popup.html/popup.js (status display, no more manual JSON paste)
- [ ] Step 5: Test extension loads without errors
- [ ] Step 6: Commit + push

### Task 7: Startup Scripts + README
**Files:**
- Create: `start-jobflow.bat`
- Create: `start-jobflow.ps1`
- Create: `setup.bat` (one-time DB setup)
- Modify: `README.md` (or create)

- [ ] Step 1: Create setup.bat (runs db init, npm install)
- [ ] Step 2: Create start-jobflow.bat
- [ ] Step 3: Create start-jobflow.ps1
- [ ] Step 4: Write README.md with setup + usage instructions
- [ ] Step 5: Commit + push

### Task 8: Final QA + Polish
- [ ] Step 1: Start server, open in browser, test every tab
- [ ] Step 2: Close browser, reopen — verify data persists
- [ ] Step 3: Test extension floating button on a job site
- [ ] Step 4: Fix any bugs found
- [ ] Step 5: Final commit + push
