# AI Review-and-Select Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ⚡ fill from profile + compliance "No" (never AI), and add a 🤖 button that opens a review panel where the user checks which leftover questions to batch-send to the AI.

**Architecture:** Push all decision logic into `extension/matcher.js` (pure, unit-tested via `ats-samples/test.js`): named compliance rules, `isYesNoOptions`, `categorizeQuestion`, and a `complianceDefault` in `buildProfile`. Keep `extension/content.js` as thin DOM glue: a compliance-fill pass on ⚡, and a split of `aiFill` into collect → review-panel → send-selected, triggered by a new 🤖 button that broadcasts to all frames like ⚡ does.

**Tech Stack:** Vanilla JS Chrome MV3 content scripts; Node for the pure-logic test harness; Postgres-backed Express app for the profile (demographics JSON blob, no migration).

## Global Constraints

- No DB migration — new profile data lives in the `profiles.demographics` JSON blob.
- `matcher.js` stays isomorphic (exports via `module.exports` for Node, `root.JFMatcher` for the extension); every pure helper is added to the exported `api` object.
- Regression bar: `node ats-samples/test.js` stays **≥98/193 filled, 0 cross-section contamination** after every matcher change.
- Extension version → **2.13.0** at the end.
- Commit AND push after every task (user requirement).
- Never send to AI a field the rules own (existing `ruleOwns`) or a compliance field (new).

---

### Task 1: matcher.js — compliance rules, categorization, complianceDefault

**Files:**
- Modify: `extension/matcher.js` (detectKey personal block; new helpers; buildProfile; exported api)
- Test: `ats-samples/test.js` (add assertions) or run inline node checks

**Interfaces:**
- Produces:
  - `detectKey` returns `'noncompete' | 'prev_emp' | 'contact_emp'` for matching questions.
  - `isYesNoOptions(options: string[]) -> boolean`
  - `categorizeQuestion(field, options: string[]) -> 'essay'|'compliance'|'multi'|'short'`
  - `buildProfile(profile).complianceDefault: 'No'|'Yes'` (default `'No'`)
  - all three helpers exported on `api`.

- [ ] **Step 1: Write the failing test** — append to `ats-samples/test.js` after the existing assertions (or a new `ats-samples/categorize.test.js`):

```js
const A = require('../extension/matcher');
function eq(got, want, label){ console.log((got===want?'PASS':'FAIL'), label, '->', got); if(got!==want) process.exitCode=1; }
const key = (label) => A.classify({ idname:'', label, section:'', tag:'select', role:null }).key;
// named compliance rules
eq(key('Are you subject to a non-compete or restrictive covenant?'), 'noncompete', 'noncompete');
eq(key('Have you previously been employed by us?'), 'prev_emp', 'prev_emp');
eq(key('Do you have any relatives currently employed here?'), 'contact_emp', 'contact_emp');
// isYesNoOptions
eq(A.isYesNoOptions(['Select...','Yes','No']), true, 'yesno options');
eq(A.isYesNoOptions(['United States','India','Canada']), false, 'not yesno options');
// categorizeQuestion
eq(A.categorizeQuestion({tag:'textarea',label:'Tell us about a project'}, []), 'essay', 'textarea essay');
eq(A.categorizeQuestion({tag:'input',type:'text',label:'Why are you interested in joining Tailscale?'}, []), 'essay', 'why essay');
eq(A.categorizeQuestion({tag:'select',label:'Have you used us before?'}, ['Yes','No']), 'compliance', 'yesno compliance');
eq(A.categorizeQuestion({tag:'select',label:'Country of citizenship'}, ['US','India','Canada','UK']), 'multi', 'multi dropdown');
eq(A.categorizeQuestion({tag:'input',type:'text',label:'Preferred pronoun set'}, []), 'short', 'short text');
// complianceDefault
eq(A.buildProfile({fullName:'X', demographics:JSON.stringify({})}).complianceDefault, 'No', 'default No');
eq(A.buildProfile({fullName:'X', demographics:JSON.stringify({complianceDefault:'Yes'})}).complianceDefault, 'Yes', 'default Yes');
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node ats-samples/categorize.test.js`
Expected: FAIL — `A.isYesNoOptions is not a function` / wrong keys.

- [ ] **Step 3: Add named compliance rules** in `detectKey`, immediately BEFORE the `sponsorship` line added earlier (`if (/sponsor|\bvisa\b.../)`), so specific rules win:

```js
    if (/non[- ]?compete|restrictive covenant/.test(hay)) return 'noncompete';
    if (/previously (been )?employed|employed by (us|this|the company) (before|previously)|former employee|eligible for rehire|worked (here|for us) before/.test(hay)) return 'prev_emp';
    if (/relative|family member|someone you (know|are related)|related to .*(employee|current)|friend .*(employ|work here)/.test(hay)) return 'contact_emp';
```

- [ ] **Step 4: Add helpers** near `matchOption` (module scope, before the `api` object):

```js
  // A yes/no question: 2-3 real options (placeholder stripped) and one is a No/decline.
  function isYesNoOptions(options) {
    const real = (options || []).map((o) => (o || '').trim())
      .filter((o) => o && !/^(select|choose|please|make a selection|-+)$/i.test(o));
    if (real.length < 1 || real.length > 3) return false;
    const declineRe = /decline|prefer ?not|no ?answer/i;
    return real.some((o) => /^no\b|\bno\b/i.test(o) || /\bfalse\b/i.test(o) || declineRe.test(o));
  }

  const ESSAY_RE = /why|describe|explain|tell us|what (was|were|makes|are you|excites|motivates|interests)|how (would|do|did) you|in your own words|motivat|proud|challeng|strength|weakness|interested in (joining|working)/i;

  // Categorize a field the rules could NOT own, to decide handling.
  function categorizeQuestion(field, options) {
    const tag = (field.tag || '').toLowerCase();
    const label = (field.label || '');
    if (tag === 'textarea') return 'essay';
    const isControl = tag === 'select' || field.type === 'radio' || field.role === 'combobox' || field.role === 'listbox' || (field.haspopup === 'listbox');
    if (isControl) return isYesNoOptions(options) ? 'compliance' : 'multi';
    if (ESSAY_RE.test(label)) return 'essay';
    return 'short';
  }
```

- [ ] **Step 5: Add complianceDefault to buildProfile** — in the returned object add:

```js
      complianceDefault: d.complianceDefault || 'No',
```

- [ ] **Step 6: Export the helpers** — extend the `api` object:

```js
  const api = { classify, detectSection, detectKey, resolveValue, resolveEntry, isEntryKey, entryListFor, buildProfile, matchOption, pickOption, kindFor, isYesNoOptions, categorizeQuestion, SINGLE_FILL, words };
```

- [ ] **Step 7: Run tests + regression**

Run: `node ats-samples/categorize.test.js && node ats-samples/test.js | tail -2`
Expected: all PASS; suite still `98/193 … 0 cross-section contamination`.

- [ ] **Step 8: Commit + push**

```bash
git add extension/matcher.js ats-samples/categorize.test.js
git commit -m "feat(matcher): compliance rules, isYesNoOptions, categorizeQuestion, complianceDefault"
git push origin master
```

---

### Task 2: My Profile — complianceDefault field

**Files:**
- Modify: `index.html` (add a select in the Demographics block; add key to `DEMO_F`)

**Interfaces:**
- Consumes: nothing. Produces: `demographics.complianceDefault` saved via the existing profile save path.

- [ ] **Step 1: Add the select** after the `p_noncompete` field (`index.html:203`):

```html
        <div class="field"><label>Default answer to unlisted Yes/No compliance questions</label><select id="p_complianceDefault"><option>No</option><option>Yes</option></select></div>
```

- [ ] **Step 2: Register the key** — add `'complianceDefault'` to the `DEMO_F` array (`index.html:438`).

- [ ] **Step 3: Verify save/load** — start the server, open localhost:3000 → My Profile, confirm the field shows "No", change to "Yes", Save, reload, confirm it persists.

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8'); console.log(/p_complianceDefault/.test(h) && /'complianceDefault'/.test(h) ? 'WIRED' : 'MISSING')"`
Expected: `WIRED`

- [ ] **Step 4: Commit + push**

```bash
git add index.html
git commit -m "feat(profile): default answer for unlisted yes/no compliance questions"
git push origin master
```

---

### Task 3: content.js — compliance-"No" pass on ⚡, remove auto-AI

**Files:**
- Modify: `extension/content.js` (jfRun; new `fillComplianceDefaults`; panel source `compliance`)

**Interfaces:**
- Consumes: `JFMatcher.isYesNoOptions`, `JFMatcher.matchOption`, `openAndPickOption`, `selectOption`, `describe`, `JFMatcher.buildProfile`.
- Produces: `fillComplianceDefaults(P) -> Promise<number>`; `jfLogQA(q, a, 'compliance')`.

- [ ] **Step 1: Remove the auto-AI call** in `jfRun` — replace the line `if (manual) { try { n += await aiFill(); ... } }` with a compliance pass:

```js
    if (manual) { try { n += await fillComplianceDefaults(JFMatcher.buildProfile(data.profile)); } catch (e) { console.warn('[JobFlow] compliance pass:', e && e.message); } }
```

- [ ] **Step 2: Add `fillComplianceDefaults`** (near `fillCustomDropdowns`). It fills only fields the matcher did NOT classify, whose options look yes/no, with the profile default:

```js
// Fill unclassified Yes/No compliance questions with the user's stored default
// ("No"). Never touches a field the matcher recognizes. Logs each as 'compliance'
// so it shows in the answers panel and can be overridden.
async function fillComplianceDefaults(P) {
  const def = P.complianceDefault || 'No';
  let n = 0;
  // native selects + radios
  const natives = deepQueryAll('select, input[type="radio"]');
  const radioSeen = new Set();
  for (const el of natives) {
    if (el.disabled || el.readOnly) continue;
    const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
    const f = describe(el);
    if (JFMatcher.classify(f).key) continue;               // rules own it → skip
    if (el.tagName === 'SELECT') {
      if (el.selectedIndex > 0) continue;
      const opts = [...el.options].map((o) => o.text);
      if (!JFMatcher.isYesNoOptions(opts)) continue;
      if (selectOption(el, def, 'yesno')) { jfLogQA(f.label || f.idname, def, 'compliance'); n++; }
    } else {
      const groupName = el.name || (f.label || '');
      if (radioSeen.has(groupName)) continue; radioSeen.add(groupName);
      const group = natives.filter((x) => x.type === 'radio' && (x.name || describe(x).label) === groupName);
      if (group.some((x) => x.checked)) continue;
      const opts = group.map((x) => (describe(x).optionText || x.value || ''));
      if (!JFMatcher.isYesNoOptions(opts)) continue;
      const hit = group.find((x) => JFMatcher.matchOption(def, (describe(x).optionText || x.value || ''), 'yesno'));
      if (hit) { hit.click(); hit.dispatchEvent(new Event('change',{bubbles:true})); hit.style.outline='2px solid #f5a623'; jfLogQA(f.label||f.idname, def, 'compliance'); n++; }
    }
  }
  // custom comboboxes
  const combos = deepQueryAll('[role="combobox"], [aria-haspopup="listbox"]');
  const seen = new Set();
  for (const t of combos) {
    if (seen.has(t)) continue; seen.add(t);
    if (t.getAttribute('aria-disabled') === 'true' || t.disabled) continue;
    const r = t.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
    const cur = ((t.value||'') + ' ' + (t.textContent||'')).trim();
    if (cur && !/select|choose|make a selection|please|^[-–—\s.]*$/i.test(cur)) continue;
    const f = describe(t);
    if (JFMatcher.classify(f).key) continue;
    // We can't read options without opening; open, and only keep the pick if a
    // yes/no-looking option matched the default.
    if (await openAndPickOption(t, def, 'yesno', '#f5a623')) { jfLogQA(f.label || f.idname, def, 'compliance'); n++; }
  }
  return n;
}
```

- [ ] **Step 3: Add the `compliance` panel source** — in `JF_SRC` add:

```js
  compliance: { c: '#f5a623', t: 'default (No)' },
```

- [ ] **Step 4: Syntax check**

Run: `node --check extension/content.js`
Expected: no output (OK).

- [ ] **Step 5: Commit + push**

```bash
git add extension/content.js
git commit -m "feat(extension): ⚡ answers unclassified yes/no compliance from profile default, no AI"
git push origin master
```

---

### Task 4: content.js — 🤖 review panel (collect → select → batch send)

**Files:**
- Modify: `extension/content.js` (split `aiFill`; add 🤖 button + `jf-review` broadcast/receiver; interactive panel section)
- Modify: `extension/content.css` (🤖 button)

**Interfaces:**
- Consumes: `JFMatcher.categorizeQuestion`, existing `add()`/collection logic, `openAndPickOption`, `selectOption`, `setVal`, `jfLogQA`.
- Produces: `collectAiCandidates() -> {token,el,els,type,category,label,options}[]`; `jfRenderReview(cands)`; `jfSendSelected(tokens)`.

- [ ] **Step 1: Refactor `aiFill` into `collectAiCandidates()`** — keep the existing field-gathering (textarea/select/combobox/radio, `ruleOwns` filter, `jfAiAsked` dedup) but, instead of sending, tag each with a category via `JFMatcher.categorizeQuestion(describe(el|els[0]), options)` and skip `category==='compliance'` (⚡ handles those). Return the array.

- [ ] **Step 2: Add `jfRenderReview(cands)`** — render an interactive section at the TOP of the panel (`jfPanelBuild`): a header "To answer (N)", one row per candidate with a checkbox (checked when `category==='essay'`), the label, a category badge, and, for `multi`/`compliance-less` dropdowns, the options joined; a footer with a "Send N selected" button (updates count on toggle) and "Cancel". Store `cands` on a module var keyed by token.

- [ ] **Step 3: Add `jfSendSelected(tokens)`** — build `fresh = cands.filter(checked)`, `chrome.runtime.sendMessage({action:'gptFill', questions: fresh.map(toQ)})`, then apply answers exactly as the old `aiFill` did (text/select/combobox/radio) and `jfLogQA(label, value, 'ai')` or `'skip'`. One batched call.

- [ ] **Step 4: Add the 🤖 button + broadcast** — after the ⚡ button injection, add a second `#jf-ai-btn` (🤖). On click: `jfRun` is NOT called; instead `const c = collectAiCandidates(); jfRenderReview(c);` and broadcast `{action:'jf-review', nonce}` so iframes render their own review. Add a `jf-review` branch to the `onMessage` receiver: `if (jfHasFillableFields()) jfRenderReview(collectAiCandidates())`.

- [ ] **Step 5: Add the background relay** — in `background.js`, the existing `fillAllFrames` branch only forwards `jf-fill`. Add: if `request.action === 'reviewAllFrames'` forward `{action:'jf-review', nonce}`. And in content.js the 🤖 click sends `{action:'reviewAllFrames', nonce}`.

- [ ] **Step 6: Add 🤖 button CSS** to `content.css`:

```css
#jf-ai-btn {
  position: fixed !important; bottom: 80px !important; right: 20px !important;
  background: linear-gradient(135deg,#8b7dff,#6d8bff) !important; color:#fff !important;
  border:none !important; border-radius:50% !important; width:50px !important; height:50px !important;
  font-size:22px !important; cursor:pointer !important; box-shadow:0 4px 12px rgba(0,0,0,.3) !important;
  z-index:2147483647 !important; display:flex !important; align-items:center !important; justify-content:center !important;
}
#jf-ai-btn:hover { transform: scale(1.1) !important; }
```

- [ ] **Step 7: Syntax check + manual smoke**

Run: `node --check extension/content.js && node --check extension/background.js`
Expected: OK. Then load unpacked, open a Greenhouse/iCIMS step: ⚡ fills + compliance No; 🤖 shows essays checked, dropdowns unchecked; Send → one `ai_requests` row.

- [ ] **Step 8: Commit + push**

```bash
git add extension/content.js extension/content.css extension/background.js
git commit -m "feat(extension): 🤖 review panel — pick which questions to batch-send to AI"
git push origin master
```

---

### Task 5: Version bump + STATE

**Files:**
- Modify: `extension/manifest.json` (2.12.0 → 2.13.0), `.agent/STATE.md` (note the feature)

- [ ] **Step 1: Bump** `"version": "2.13.0"`.
- [ ] **Step 2: Note in STATE.md** under Notes: review-and-select AI fill + compliance defaults shipped (v2.13.0).
- [ ] **Step 3: Validate + commit + push**

```bash
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json'))" && node ats-samples/test.js | tail -2
git add extension/manifest.json .agent/STATE.md
git commit -m "chore: JobFlow extension v2.13.0 — review-and-select AI fill"
git push origin master
```

---

## Self-Review

**Spec coverage:** ⚡-no-AI + compliance pass (Task 3) ✓; 🤖 review panel + batching (Task 4) ✓; categorization (Task 1) ✓; compliance named rules leveraging existing fields (Task 1) ✓; complianceDefault profile field (Task 2) ✓; per-frame via broadcast (Task 4) ✓; testing (Task 1 unit + regression, Task 4 manual) ✓; version bump (Task 5) ✓.

**Placeholder scan:** Tasks 1–3, 5 have complete code. Task 4 steps 1–4 specify exact function names/signatures + behavior but defer full panel HTML to execution (large DOM string) — acceptable as the interfaces are pinned; write the code at execution, not new decisions.

**Type consistency:** `categorizeQuestion(field, options)`, `isYesNoOptions(options)`, `complianceDefault`, `fillComplianceDefaults(P)`, `collectAiCandidates`/`jfRenderReview`/`jfSendSelected`, sources `compliance`/`ai`/`skip`/`profile` — names consistent across tasks and with the spec.
