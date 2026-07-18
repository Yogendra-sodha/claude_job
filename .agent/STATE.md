# JobFlow — Autonomous Work State

## Current Mission
Upgrade JobFlow from a static file://index.html app to a full-stack local application:
- **Node.js + Express backend** serving the app at http://localhost:3000
- **PostgreSQL database** for true data persistence (profile, apps, contacts, materials, settings)
- **Chrome extension v2** that fetches profile from the local API (no copy/paste), injects a floating autofill button on job pages, fills profile + cover letter + work history
- **Desktop shortcut** (`start-jobflow.bat`) that auto-starts server + opens browser

## Approved Design
- Approach A: Node.js backend + PostgreSQL + Extension talks to local API
- User wants: floating button (not auto-fill), fills profile + cover letter + work history
- PostgreSQL: use default `postgres` user, user knows their password
- Commit + push at every step
- Autonomous work: save state, schedule resumption after usage limits

## Hard Rules
- Commit + push after every meaningful step
- Update this STATE.md after every burst so context survives model changes
- Never break the app: validate before commit
- Keep bursts small (~15 tool calls) to avoid cap kills
- PostgreSQL 18 at: C:\Program Files\PostgreSQL\18\bin\
- Node.js v24.13.1, npm 11.8.0
- Remote: https://github.com/Yogendra-sodha/claude_job.git branch master

## Progress Tracker
- [x] Phase 1: Write design spec → `docs/superpowers/specs/2026-07-18-persistence-upgrade-design.md`
- [x] Phase 2: Write implementation plan → `docs/superpowers/plans/2026-07-18-persistence-upgrade.md`
- [x] Phase 3: Backend scaffolding (package.json, server.js, db.js, schema.sql)
- [x] Phase 4: API routes (profile, apps, contacts, materials, settings)
- [x] Phase 5: Migrate index.html from localStorage → API calls
- [x] Phase 6: Extension v2 (floating button, API-backed, content script)
- [x] Phase 7: Desktop shortcut + auto-start script
- [x] Phase 8: Testing + QA pass
- [x] Phase 9: Final commit + push + README update

## Current Phase: Phase 9 — Completed
## Last Burst: 2026-07-18 13:48 EDT — Completed persistence upgrade!

## Environment
- PostgreSQL 18 running as service `postgresql-x64-18`
- psql at: C:\Program Files\PostgreSQL\18\bin\psql.exe
- Node v24.13.1, npm 11.8.0
- Git remote verified working

## Notes
- User wants Jobright-like experience: seamless, one-click, no manual data transfer
- User will be away — work autonomously, make sensible decisions
- Original backlog items R8-R13 are paused; this persistence upgrade takes priority
