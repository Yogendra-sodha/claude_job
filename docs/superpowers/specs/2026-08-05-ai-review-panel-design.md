# Design — Review-and-Select AI Fill + Profile Compliance Defaults

Date: 2026-08-05
Status: Approved (pending spec review)
Area: Chrome extension (`extension/`) + My Profile (`index.html`, demographics blob)

## Problem

Today, clicking ⚡ runs the rule pass **and then auto-sends every leftover question to the
paid AI** (`aiFill()` inside `jfRun`). This spends money on:

- questions the answer to is trivially "No" (compliance: relatives employed, non-compete,
  previously employed, referred), and
- questions the profile already answers,

with no chance to review what gets sent. The user wants: **AI never fires automatically**;
a review step that shows exactly which questions *would* go to the AI; per-question choice of
what to send; and compliance questions answered from a stored default ("No") instead of paid guesses.

Three alternatives were compared (inline per-field icons, batch panel, panel + profile
defaults). Inline icons were rejected: the essay-vs-compliance decision is identical in all
three, but anchoring a floating icon to each field across scroll/resize/React-re-render inside
iframes is the highest-maintenance, most bug-prone part. The approved design is the synthesis below.

## Goals

1. ⚡ **never calls the AI.** It fills from the profile and answers compliance yes/no questions
   from the user's stored default. Zero network/AI cost.
2. A separate 🤖 button opens a **review panel**: unanswered AI-candidate questions, each with a
   checkbox, essays pre-checked, factual dropdowns unchecked.
3. **One batched "Send N selected" call** (not per-question) so the profile is sent once, not N times.
4. Compliance answers come from **My Profile defaults**, visible and overridable in the answers panel.

## Non-goals (YAGNI)

- Inline per-field AI icons (possible later phase).
- Cross-frame aggregation into a single top-frame panel (per-frame panels, as today).
- Per-question individual send buttons (batching is cheaper and is the whole point of the review step).

## Behavior

### ⚡ Fill (revised)
1. Rule pass `fillForm(profile, letter)` — unchanged (profile → recognized fields).
2. **New compliance pass** `fillComplianceDefaults(P)` — for every still-empty yes/no field the
   rule pass did not classify, fill the user's default ("No"), and log it to the answers panel as
   source `compliance` ("from your default"). Uses the existing `openAndPickOption` / native-select
   / radio helpers with `val = 'No'`, `kind = 'yesno'`.
3. **The auto-AI call is removed.** ⚡ never reaches `aiFill`.

### 🤖 Review AI (new)
1. Second floating button, stacked above ⚡. Click broadcasts `jf-review` to all frames (same
   mechanism as `jf-fill`), so it reaches the iframe that holds the form.
2. Each frame runs `collectAiCandidates(P)` — the current `aiFill` collection logic, minus the
   send — producing a categorized list (see below). No network call.
3. Frames with candidates render the **review section** at the top of the answers panel. Frames
   with none show "Nothing needs the AI — everything is filled from your profile."
4. User toggles checkboxes, clicks **"Send N selected"**. Only checked questions are batched into a
   single `gptFill` call, answers fill the form (purple), and each is logged to the answered list.
5. "Cancel" / × closes the review section; the answered log remains.

## Categorization (pure, in `matcher.js`, testable)

`categorizeQuestion(field, options)` → `'essay' | 'compliance' | 'multi' | 'short'`, run only on
fields where `classify()` returned no key and the profile holds no value (i.e. the rules don't own it):

| Category | Detection | Handling |
|---|---|---|
| `compliance` | select/radio/combobox; 2–3 real options; at least one is a No/decline option (`matchOption('no', opt, 'yesno')` or decline regex) | ⚡ fills the profile default; listed in answered log, overridable |
| `essay` | `textarea`, OR label matches `/why\|describe\|explain\|tell us\|what (was\|were\|makes\|are you\|excites\|motivates)\|how (would\|do\|did) you\|in your own words\|motivat\|proud\|challeng\|strength\|weakness\|interested in (joining\|working)/i` | 🤖 panel, **checked** |
| `multi` | select/radio/combobox with >3 options or non-yes/no options | 🤖 panel, **unchecked**, options shown |
| `short` | text input that is a question but not essay-matched | 🤖 panel, **unchecked** |

### Named compliance rules (leverage existing profile fields)
`detectKey` already resolves `noncompete`, `prev_emp`, `contact_emp` (values, `kindFor='yesno'`,
`YESNO_KEYS`) but has **no rules mapping questions to them**. Add rules so specific questions map to
the user's specific stored answer instead of the generic default:

- `/non[- ]?compete|restrictive covenant/` → `noncompete`
- `/previously (been )?employed|worked (here|for us|at this)|former employee|rehire/` → `prev_emp`
- `/relative|family member|friend|someone you know.*(employ|work)|related to .*(employee|current)/` → `contact_emp`

A yes/no "were you referred by an employee?" question is **not** given a named rule — it falls
through to the generic `complianceDefault` (No). (The existing `referrerName` rule still handles the
separate *text* field "name of the person who referred you".) Anything yes/no that isn't classified
falls back to `complianceDefault`.

**Edge case — classified but unanswered yes/no:** the compliance pass targets only fields the matcher
could **not** classify. A field the matcher *does* recognize but for which the profile is empty
(e.g. `age18` with no stored value) is **left blank**, not defaulted — its correct answer is not
necessarily "No", so we never guess it. The user completes it via their profile or by hand.

## Profile change (My Profile)

Add to the demographics blob (no DB migration — it is a JSON column):

- `complianceDefault` — default answer for unrecognized yes/no compliance questions. Values
  `'No'` (default) / `'Yes'`. One `<select id="p_complianceDefault">` in the Demographics section of
  `index.html`; add `'complianceDefault'` to the `DEMO_F` array so it saves/loads with the rest.
- The already-present `noncompete` / `prev_emp` / `contact_emp` selects (Yes/No) continue to hold
  the user's specific answers; the new named rules above make them apply.

`buildProfile()` reads `d.complianceDefault || 'No'`. The extension already receives the full
demographics blob via `/api/data/extension`, so no server route changes are required.

## Components & data flow

```
index.html (My Profile)
  Demographics: complianceDefault (No), noncompete, prev_emp, contact_emp
        │  saved into profiles.demographics (JSON)
        ▼
/api/data/extension  ──►  content.js jfGetData()  ──►  JFMatcher.buildProfile()
        │
   ⚡ jfRun(fill): fillForm() → fillComplianceDefaults(P)      [NO AI]
        │                                   └─ logs source 'compliance'
   🤖 broadcast 'jf-review' → collectAiCandidates(P) → renderReview()
        │                                   └─ categorizeQuestion() (matcher.js)
        └─ "Send N selected" → gptFill (ONE batched call) → fill → log source 'ai'
```

### `content.js` changes
- `jfRun`: remove `if (manual) n += await aiFill()`; add `n += await fillComplianceDefaults(P)` in
  the ⚡ path.
- New `fillComplianceDefaults(P)`: iterate unfilled yes/no unclassified fields, pick default option.
- Split `aiFill()` into: `collectAiCandidates(P)` (returns `[{token, el/els, type, category, label,
  options}]`), `renderReviewSection(candidates)` (checkboxes + Send/Cancel), `sendSelected(tokens)`
  (batch → gptFill → apply → log). Reuse `openAndPickOption`, `selectOption`, `setVal`, `matchOption`.
- New 🤖 button injection + click handler (broadcast `jf-review`); receiver handles `jf-review`.
- Extend the panel (`jfPanelBuild`) with an interactive **"To answer"** section above the answered
  log. `jfLogQA` gains a `compliance` source colour/label.

### `matcher.js` changes
- `categorizeQuestion(field, options)` + `isYesNoOptions(options)` helpers (pure, exported).
- Named compliance rules in `detectKey` (noncompete/prev_emp/contact_emp/referral).
- `buildProfile`: add `complianceDefault`.

### `matcher.js` / `background.js`
- `background.js` unchanged (`gptFill` already batches a `questions` array).

## Error handling
- 🤖 with no candidates → informational message, no call.
- Send with nothing checked → disabled button / "select at least one".
- `gptFill` disabled/no-key/error → existing flash messages, review section stays open to retry.
- Compliance default applied but no matching "No" option present → skip (leave blank), do not guess.
- All per-field apply wrapped in try/catch as today; one bad field never aborts the batch.

## Testing
- **`matcher.js` unit tests** (extend `ats-samples/test.js` or a sibling): `categorizeQuestion` over
  representative fields (essay / yes-no / multi / short); `isYesNoOptions`; the new named compliance
  rules (non-compete, previously-employed, relative, referral) classify correctly and still 0
  cross-section contamination; `buildProfile` surfaces `complianceDefault`.
- **Regression:** existing suite stays ≥98/193 with 0 contamination.
- **Manual (real page):** on an iCIMS/Greenhouse step — ⚡ fills profile + compliance "No" and makes
  no `ai_requests` row; 🤖 lists only essays (checked) + factual dropdowns (unchecked); "Send"
  creates exactly one `ai_requests` row for the checked set.

## Rollout
- Bump manifest to 2.13.0. Commit in small units (matcher rules+tests → compliance pass → review
  panel → profile field). Update `.agent/STATE.md`.
