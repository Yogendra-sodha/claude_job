# JobFlow — Known Problems & Planned Improvements

Backlog for the autofill extension + server, written 2026-07-23.
Mirrored to GitHub Issues via `scripts/create-github-issues.sh`.

Line references are against commit `c130969`.

---

## Open bugs

### B1 — The AI is asked to choose from a dropdown's options but is never shown them
`aiFill()` passes an `options` array for `<select>` ([content.js:591](../extension/content.js#L591))
and radio groups ([content.js:618](../extension/content.js#L618)) — but **not** for custom
comboboxes ([content.js:602](../extension/content.js#L602)), which is the widget every modern ATS
(Workday, iCIMS, Oracle/CVS) uses for demographic and eligibility questions.

The system prompt in [routes/gptfill.js](../routes/gptfill.js) says:
> If the question has an "options" array, return EXACTLY one of those option strings, copied verbatim.

Combobox questions never carry that array, so the model invents a string that then has to be
fuzzy-matched back onto the real option list. This is the single biggest source of wrong selections.

**Evidence:** a logged request for a CVS Health form sent 4 combobox questions
(veteran / gender / ethnicity / hispanic), none with an `options` key.

**Fix:** harvest each combobox's option texts (open it, or read `aria-controls`/the listbox) before
calling the model, pass them as `options`, and constrain the applied answer to an exact member.

### B2 — A dropdown is marked "handled" on attempt, so a late-rendering menu is never retried
`fillCustomDropdowns()` adds the question signature to `jfDoneQuestions` *before* it knows whether
an option matched. If the listbox renders slower than the 350 ms wait, or the widget needs a
different open gesture, that field is permanently skipped for the life of the page — no retry on the
next ⚡ click or MutationObserver pass.

**Fix:** track attempts separately from successes; retry N times with backoff; only permanently skip
after repeated genuine "opened but nothing matched" outcomes.

### B3 — A dropdown we can't open now fails silently
Since `c130969`, fields the matcher can classify and holds a value for are (correctly) never sent to
the paid AI. But if the rule pass then fails to *open* that widget, nothing fills it and nothing
reports it — the answers panel lists only successes.

**Fix:** when a classified field with a known value fails to fill, log it to the panel as
"couldn't fill" (amber) along with the value we intended, so it can be set by hand.

---

## Improvements

### I1 — Cache answers per question so the same one is never paid for twice
Every application re-asks the same open-ended questions; `routes/gptfill.js` calls the provider every
time and reuses nothing.

Add a `question_answers` table keyed by a normalized hash of the question text (+ option set). Serve
from cache on hit, call the model only on a miss, and add a review screen to edit/approve cached
answers. Expected effect: near-zero marginal cost after the first few applications.

### I2 — Surface AI spend in the app UI
`GET /api/gpt-fill/log` already returns every request with `input_tokens`/`output_tokens` and running
totals, but `index.html` never calls it (0 references). Add a Settings → AI panel showing total calls,
tokens, estimated cost, and a table of recent requests.

### I3 — Let me correct an answer in the panel and save it to my profile
The answers panel is read-only. When it picks something wrong or leaves a field blank there's no way
to fix it in place or teach it. Give each row an inline edit that re-applies the value to the form and
offers "remember this" → writes to the profile / answer cache, so future applications are right
without the AI.

### I4 — Redact profile PII from stored AI prompts
`record()` stores the full prompt (system + user, up to 20 000 chars) in `ai_requests.prompt`, and the
user message embeds the entire candidate profile — name, email, phone, address, work history. It is a
local database, but the log exists to debug prompt/answer *shape*, not to archive personal data.

Store the question set plus a profile fingerprint (or a redacted copy) instead, and add a purge command.

### I5 — Make the ATS test suite runnable on a fresh clone
`ats-samples/test.js` is the safety net for matcher changes (currently **98/193** fills, 0
cross-section contamination), but `ats-samples/*.json` is gitignored because raw captures leak resume
filenames into labels. A fresh clone or CI run therefore has no fixtures.

Commit a sanitized fixture set (scrub filenames/PII in `capture.js`), then run the suite in GitHub
Actions on every push so matcher regressions are caught automatically.

### I6 — Post-fill verification pass
Nothing checks the form after filling. Add a pass that re-reads it and reports required fields still
empty, plus anything we filled that the site rejected or reverted (common with React-controlled
inputs), shown in the panel as a pre-submit checklist.

### I7 — Confidence + "needs review" flag per answer
Fills are not equally trustworthy: exact option match ≫ stem match ≫ AI free text. The panel shows
the source but not the confidence. Attach a confidence score to each fill and flag the low ones, so a
quick scan before submitting catches the risky ones.

---

## Fixed in `c130969`

### F1 — Gender "Male" selected "Female"
`matchOption`'s substring fallback made `"female".includes("male")` true, and Female sorts before
Male. The same bug matched "Asian" to "Caucasian". Replaced with whole-word / shared-stem matching
(`looseMatch`), keeping stem matches like Bachelors ↔ "Bachelor's Degree". Same fix applied to
`pickOption` for native selects.

### F2 — Demographic questions sent to the paid AI although the answers were in the profile
The matcher's EEO block was gated on `isChoice`, which excluded custom `role="combobox"` widgets — so
they classified as `key=null`, the rule pass skipped them, and they fell through to the paid AI, which
just echoed back profile values. `isChoice` now includes combobox/listbox widgets, and `aiFill`'s new
`ruleOwns()` never sends a field to the model when the matcher can classify it and we already hold a
value. Test fills rose **92 → 98** with 0 contamination.

Also fixed: race dropdowns misread as the binary Hispanic question (the combobox label is polluted
with every option's text) now prefer the field's own id and pick "Asian" rather than "Hispanic or Latino".

### F3 — No visibility into what was asked and answered
Added an on-page answers panel listing every question and the chosen value, colour-coded by source
(profile / AI / not answered) with a running count.
