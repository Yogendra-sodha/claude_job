#!/usr/bin/env bash
# Creates the JobFlow backlog (docs/BACKLOG.md) as GitHub Issues.
# Requires: gh CLI, authenticated (`gh auth login`).
# Safe to read before running; it only creates issues + labels on this repo.
#
#   bash scripts/create-github-issues.sh
#
set -euo pipefail

REPO="Yogendra-sodha/claude_job"
FIX="c130969"

command -v gh >/dev/null || { echo "gh CLI not found. Install: winget install --id GitHub.cli"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not authenticated. Run: gh auth login"; exit 1; }

echo "Creating labels…"
mklabel() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null 2>&1 || true; }
mklabel bug         d73a4a "Something is broken"
mklabel improvement a2eeef "Enhancement or new capability"
mklabel autofill    5319e7 "Extension form-filling engine"
mklabel ai          8b7dff "LLM usage, prompts, cost"
mklabel cost        fbca04 "Reduces or exposes spend"
mklabel privacy     0e8a16 "Personal data handling"
mklabel testing     c2e0c6 "Test suite / CI"
mklabel ux          d4c5f9 "User-facing experience"

new() { # new <title> <labels> <body>
  local url
  url=$(gh issue create --repo "$REPO" --title "$1" --label "$2" --body "$3")
  echo "  $url"
  echo "$url"
}

echo
echo "Creating open bugs…"

new "AI is asked to choose from a dropdown's options but is never shown them" "bug,autofill,ai" \
"\`aiFill()\` passes an \`options\` array for \`<select>\` (extension/content.js:591) and radio groups
(extension/content.js:618) — but **not** for custom comboboxes (extension/content.js:602), which is the
widget every modern ATS (Workday, iCIMS, Oracle/CVS) uses for demographic and eligibility questions.

The system prompt in \`routes/gptfill.js\` says:

> If the question has an \"options\" array, return EXACTLY one of those option strings, copied verbatim.

Combobox questions never carry that array, so the model invents a string that then has to be
fuzzy-matched back onto the real option list. This is the single biggest remaining source of wrong
selections.

**Evidence:** a logged request for a CVS Health form sent 4 combobox questions (veteran / gender /
ethnicity / hispanic), none with an \`options\` key.

**Fix:** harvest each combobox's option texts (open it, or read \`aria-controls\`/the listbox) before
calling the model, pass them as \`options\`, and constrain the applied answer to an exact member of
that list." > /dev/null

new "Dropdown marked 'handled' on attempt, so a late-rendering menu is never retried" "bug,autofill" \
"\`fillCustomDropdowns()\` adds the question signature to \`jfDoneQuestions\` *before* it knows whether
an option actually matched.

If the listbox renders slower than the 350 ms wait, or the widget needs a different open gesture, that
field is permanently skipped for the life of the page — no retry on the next ⚡ click or
MutationObserver pass.

**Fix:** track attempts separately from successes; retry N times with backoff; only permanently skip
after repeated genuine \"opened but nothing matched\" outcomes." > /dev/null

new "A dropdown we can't open now fails silently (filled by neither rules nor AI)" "bug,autofill,ux" \
"Since $FIX, fields the matcher can classify and holds a value for are (correctly) never sent to the
paid AI. But if the rule pass then fails to *open* that widget, nothing fills it and nothing reports
it — the answers panel lists only successes.

**Fix:** when a classified field with a known value fails to fill, log it to the panel as
\"couldn't fill\" (amber) along with the value we intended, so it can be set by hand." > /dev/null

echo
echo "Creating improvements…"

new "Cache answers per question so the same question is never paid for twice" "improvement,ai,cost" \
"Every application re-asks the same open-ended questions; \`routes/gptfill.js\` calls the provider every
time and reuses nothing.

**Proposal:** a \`question_answers\` table keyed by a normalized hash of the question text (+ option
set). Serve from cache on hit, call the model only on a miss, and add a review screen to edit/approve
cached answers.

**Expected effect:** near-zero marginal cost after the first few applications." > /dev/null

new "Surface AI token spend and request log in the app UI" "improvement,ai,cost" \
"\`GET /api/gpt-fill/log\` already returns every request with \`input_tokens\`/\`output_tokens\` and
running totals, but \`index.html\` never calls it (0 references).

Add a **Settings → AI** panel showing total calls, total tokens, estimated cost, and a table of recent
requests (question count, model, tokens, errors)." > /dev/null

new "Let me correct an answer in the panel and save it back to my profile" "improvement,ux" \
"The answers panel added in $FIX is read-only. When it picks something wrong or leaves a field blank,
there is no way to fix it in place or teach it.

**Proposal:** give each row an inline edit; changing a value re-applies it to the form and offers
\"remember this\" → writes to the profile / answer cache, so future applications are right without
involving the AI." > /dev/null

new "Redact profile PII from stored AI prompts" "improvement,privacy" \
"\`record()\` in \`routes/gptfill.js\` stores the full prompt (system + user, up to 20 000 chars) in
\`ai_requests.prompt\`, and the user message embeds the entire candidate profile — name, email, phone,
address, work history.

It is a local database, so exposure is limited, but the log exists to debug prompt/answer *shape*, not
to archive personal data.

**Fix:** store the question set plus a profile fingerprint (or a redacted copy) instead of the raw
profile, and add a retention/purge command." > /dev/null

new "Make the ATS test suite runnable on a fresh clone (sanitized fixtures + CI)" "improvement,testing" \
"\`ats-samples/test.js\` is the safety net for matcher changes (currently **98/193** fills, 0
cross-section contamination), but \`ats-samples/*.json\` is gitignored because raw captures leak resume
filenames into labels. A fresh clone or CI run therefore has no fixtures at all.

**Fix:** commit a sanitized fixture set (scrub filenames/PII in \`capture.js\`), then run the suite in
GitHub Actions on every push so matcher regressions are caught automatically." > /dev/null

new "Post-fill verification pass (report required fields still empty)" "improvement,autofill" \
"Nothing checks the form after filling.

Add a pass that re-reads the form and reports required fields still empty, plus anything we filled
that the site rejected or reverted (common with React-controlled inputs), shown in the panel as a
pre-submit checklist." > /dev/null

new "Confidence score and 'needs review' flag per answer" "improvement,ux" \
"Fills are not equally trustworthy: exact option match >> stem match >> AI free text. The panel shows
the source but not the confidence.

Attach a confidence score to each fill and flag the low-confidence ones for review, so a quick scan
before submitting catches the risky ones." > /dev/null

echo
echo "Filing the three already-fixed problems as a record (closed)…"

close_fixed() { # close_fixed <title> <labels> <body>
  local url num
  url=$(gh issue create --repo "$REPO" --title "$1" --label "$2" --body "$3")
  num="${url##*/}"
  gh issue close "$num" --repo "$REPO" --comment "Fixed in $FIX." >/dev/null
  echo "  $url (closed)"
}

close_fixed "Gender 'Male' selected the 'Female' option" "bug,autofill" \
"\`matchOption\`'s substring fallback made \`\"female\".includes(\"male\")\` true, and Female sorts
before Male in the option list — so selecting gender \"Male\" clicked **Female**. The same bug matched
\"Asian\" to \"Caucasian\".

**Fixed in $FIX:** replaced the raw substring test with whole-word / shared-stem matching
(\`looseMatch\`), which still matches Bachelors ↔ \"Bachelor's Degree\". Same fix applied to
\`pickOption\` for native selects." > /dev/null

close_fixed "Demographic questions sent to the paid AI although the answers were in the profile" "bug,ai,cost" \
"Gender, race, veteran and disability questions were sent to the paid model on every run even though
those answers are stored in the profile — the model simply echoed them back.

**Root cause:** the matcher's EEO block was gated on \`isChoice\`, which excluded custom
\`role=\"combobox\"\` widgets. Those fields classified as \`key=null\`, so the rule pass skipped them
and they fell through to the AI.

**Fixed in $FIX:** \`isChoice\` now includes combobox/listbox widgets, and \`aiFill\`'s new
\`ruleOwns()\` never sends a field to the model when the matcher can classify it and we already hold a
value. Test fills rose **92 → 98** with 0 cross-section contamination.

Also fixed: race dropdowns misread as the binary Hispanic question (a custom combobox's label is
polluted with every option's text) now prefer the field's own id and pick \"Asian\" instead of
\"Hispanic or Latino\"." > /dev/null

close_fixed "No visibility into which questions were asked and how they were answered" "improvement,ux" \
"Filling was opaque — only transient toasts, so there was no way to see what had been asked or what
value was chosen (Jobright shows this while it fills).

**Fixed in $FIX:** added an on-page answers panel listing every question and the chosen value,
colour-coded by source (profile / AI / not answered) with a running count." > /dev/null

echo
echo "Done. View them:  gh issue list --repo $REPO"
