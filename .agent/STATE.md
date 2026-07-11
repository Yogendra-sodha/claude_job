# JobFlow — Autonomous Work State

## Mission
Make JobFlow the fastest path through the user's real job-application journey:
**find jobs → check fit → tailor resume/cover letter → apply (autofill) → find people at company → ask referral → track → follow up.**
User (Yogendra) is away; work autonomously. He will NOT answer questions — make sensible decisions alone.

## Hard rules
- STOP TIME: 2026-07-12 16:00 EST (20:00 UTC). After that: final commit+push, summary, end loop.
- Usage cap: cannot read the meter. Be conservative: ONE small feature burst per wake-up,
  then sleep 30–60 min (1800–3600s). If any sign of rate-limiting/errors, sleep 3600s.
- EVERY burst: implement → validate JS parses (node) → `git add -A && git commit && git push`.
- Never break the app: validate before commit. index.html must stay a single self-contained file.
- No auto-apply bots / scraping (ToS risk). No external services that receive his data.
- Commit messages: short imperative + Co-Authored-By Claude line.
- NEVER mark backlog items done or write Done-log entries before the commit actually exists.

## Validate command
cd "c:/Users/yuvis/OneDrive/Desktop/Weekend/claude_job" && node -e "const fs=require('fs');const m=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/);try{new Function(m[1]);console.log('OK')}catch(e){console.log('FAIL',e.message)}"

## Backlog (priority order — pick top unchecked item each burst)
- [ ] R1. Referral flow: Referrals tab — per-application people-finder links (LinkedIn people search:
      recruiters / hiring managers / teammates + Google X-ray), contact list per application with
      status (to-message/messaged/replied/referred/declined), ✉ Message button prefills Generate
      with contact name + stored JD. saveGen stores jd. Generate gets optional "contact name" field.
- [ ] R2. Dashboard "Today's actions" panel: follow-ups due, applied-but-no-referral-ask nudges,
      contacts still in "to-message". Each with a jump button.
- [ ] R3. Materials library: saveGen also saves the generated text; Tracker row expand (📄) shows saved
      cover letter/messages per application so nothing is lost; copy buttons.
- [ ] R4. Resume builder/export: printable tailored-resume page (profile + tailored bullets pasted in),
      opens print dialog → save as PDF. ATS-clean single-column format.
- [ ] R5. Follow-up automation aids: when status→applied, auto-suggest followup date (+7d);
      mailto: link generation with prefilled follow-up email subject/body.
- [ ] R6. Extension v1.1: fill cover-letter textareas from a stored "current cover letter"
      (extension popup textarea slot); more selectors (Workday data-automation-id patterns).
- [ ] R7. Feed improvements: "hide jobs I've saved/applied" (match vs tracker), save-for-later button
      on feed cards (status=saved), remember last feed results in localStorage.
- [ ] R8. Outreach follow-up nudges: contacts messaged >4 days ago with no reply → Today panel nudge.
- [ ] R9. Onboarding polish: first-run checklist on Dashboard (profile → feed → generate → extension),
      each step checks off automatically.
- [ ] R10. README.md for repo: what this is, how to use.
- [ ] R11. QA pass: code-review every handler for dead references/bugs, fix what's found.
- [ ] R12. Interview-prep generator: paste JD → likely interview questions + STAR answer skeletons
      from profile (new Generate tab kind).
- [ ] R13. Salary-negotiation message kind in Generate.

## Done log (append one line per burst AFTER the commit exists: date/time UTC — what shipped — commit)
- 2026-07-11 — v1: cockpit app (profile/find/generate/tracker/settings), fit score, free+API modes; v2: Job Feed + Autofill extension — 23f0bd7 (committed by user)

## Notes / decisions
- Remote: https://github.com/Yogendra-sodha/claude_job.git branch master. Push verified working.
- gh CLI not installed — plain git only.
- Free APIs verified live w/ CORS: remotive.com/api, arbeitnow.com/api, remoteok.com/api.
- Adzuna optional (user must get free key) — UI already in Job Feed tab.
- User's OpenAI key mode already supported; default is free/manual prompt-copy mode.
