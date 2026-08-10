// JobFlow Autofill — Content Script
// Fetches profile data from the local JobFlow server and fills the current form.
// Field classification lives in matcher.js (loaded first) and is verified
// against real captured forms by ats-samples/test.js.

const JF_API = 'http://127.0.0.1:3000/api/data/extension';

// Identifies this frame so a fill-broadcast doesn't double-run in its originator
const JF_NONCE = Math.random().toString(36).slice(2) + Date.now();

// ---- Deep query that pierces open shadow DOM (Workday, iCIMS, web components) ----
function deepQueryAll(selector, root, out) {
  out = out || [];
  root = root || document;
  try {
    root.querySelectorAll(selector).forEach((e) => out.push(e));
    root.querySelectorAll('*').forEach((e) => {
      // Never descend into our own panel's shadow root — its review checkboxes
      // are not form fields to fill.
      if (e.shadowRoot && e.id !== 'jf-panel-host') deepQueryAll(selector, e.shadowRoot, out);
    });
  } catch (e) { /* detached/cross-origin — skip */ }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Poll for a custom dropdown's REAL options to render, up to timeoutMs ----
// Skips "Loading…"/"Searching…" placeholders, so async/remote typeaheads (e.g. the
// Greenhouse Location field, which searches over the network) get enough time to
// return results instead of being abandoned after a fixed short wait.
async function jfWaitForOptions(collect, timeoutMs) {
  const real = (list) => list.filter((o) => {
    const t = (o.textContent || '').trim();
    return t && !/^(loading|searching|please wait|no results|type to|start typing|\.{2,}|…)/i.test(t);
  });
  const deadline = Date.now() + timeoutMs;
  let opts = real(collect());
  while (!opts.length && Date.now() < deadline) {
    await sleep(150);
    opts = real(collect());
  }
  return opts;
}

// Best single word to type into a typeahead to surface its options: the longest
// alphanumeric word (more distinctive than the first — "protected" over "I",
// "Jersey" over a stop-word), so react-select's filter reveals the right option.
function jfSearchTerm(val) {
  const words = String(val).replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter((w) => w.length >= 3);
  return words.sort((a, b) => b.length - a.length)[0] || '';
}

// Commit a matched dropdown option, VERIFYING it took effect. Clicking the option
// works for most widgets, but some (e.g. certain Greenhouse EEO selects) only
// commit on Enter of the highlighted row — a click there is a silent no-op, which
// is why race/ethnicity "filled" but nothing was selected. So: click; if the menu
// is still open, keyboard-navigate onto the matched row and press Enter. Returns
// true only when the menu actually closed (real selection), never a false success.
// `t` = the combobox input/trigger, `hit` = the matched option element, `collect`
// = the option-collecting function used by the caller.
async function jfSelectOption(t, hit, collect) {
  try { hit.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  ['mouseover', 'mousemove', 'mousedown', 'mouseup'].forEach((tp) => hit.dispatchEvent(new MouseEvent(tp, { bubbles: true })));
  if (typeof hit.click === 'function') hit.click();
  await sleep(90);
  let live = collect();
  if (!live.length) return true;                       // menu closed → selection took
  const sameText = (o) => (o.textContent || '').trim() === (hit.textContent || '').trim();
  const idx = live.findIndex((o) => o === hit || sameText(o));
  if (idx < 0) return false;
  const cur = live.findIndex((o) => /focus|highlight|active|selected/i.test(o.className || ''));
  const from = cur >= 0 ? cur : 0;
  const key = idx >= from ? 'ArrowDown' : 'ArrowUp';
  for (let k = 0; k < Math.abs(idx - from); k++) {
    t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await sleep(25);
  }
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  t.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  await sleep(90);
  return !collect().length;                            // selected iff the menu closed
}

// ---- Small transient on-page message (no ugly alert() spam) ----
function jfFlash(msg, color) {
  let f = document.getElementById('jf-flash');
  if (!f) {
    f = document.createElement('div');
    f.id = 'jf-flash';
    document.body.appendChild(f);
  }
  f.textContent = msg;
  f.style.cssText =
    'position:fixed;bottom:20px;right:84px;max-width:280px;background:#171a2b;color:#e7e9f3;' +
    'border-left:4px solid ' + (color || '#6d8bff') + ';padding:12px 14px;border-radius:10px;' +
    'font:13px/1.5 "Segoe UI",Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);' +
    'z-index:2147483647;opacity:1;transition:opacity .4s';
  clearTimeout(f._t);
  f._t = setTimeout(() => { f.style.opacity = '0'; }, 6000);
}

// ---- Transparency panel (Jobright-style): shows every question we answered
// and the value we chose, colour-coded by source, so nothing fills silently. ----
let jfPanelEl = null, jfPanelList = null, jfPanelCount = null, jfReviewSection = null;
const jfPanelSeen = new Set();
const JF_SRC = { profile: { c: '#3ecf8e', t: 'from profile' }, ai: { c: '#8b7dff', t: 'AI' }, compliance: { c: '#f5a623', t: 'default (No)' }, skip: { c: '#f59e0b', t: 'not answered' } };
function jfPanelBuild() {
  if (jfPanelEl) return jfPanelEl;
  // Render inside a Shadow DOM so the host site's CSS can't reach the panel.
  // Un-isolated, inherited properties (line-height, letter-spacing, writing-mode,
  // font) bleed in from aggressive ATS stylesheets and garble/overlap the rows —
  // this is the fix for the "jumbled panel" report.
  const host = document.createElement('div');
  host.id = 'jf-panel-host';
  host.style.cssText = 'all:initial';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const reset = document.createElement('style');
  // :host neutralises anything inherited from the page; * gives every node clean
  // text defaults so nothing the site set can cross the boundary.
  reset.textContent =
    ':host{all:initial}' +
    '*{box-sizing:border-box;margin:0;padding:0;font-family:"Segoe UI",Arial,sans-serif;' +
    'letter-spacing:normal;word-spacing:normal;text-transform:none;line-height:normal;' +
    'writing-mode:horizontal-tb;direction:ltr;text-align:left;white-space:normal;' +
    'font-style:normal;text-indent:0;float:none;position:static}';
  shadow.appendChild(reset);
  jfPanelEl = document.createElement('div');
  jfPanelEl.id = 'jf-panel';
  jfPanelEl.style.cssText =
    'position:fixed;bottom:140px;right:20px;width:330px;max-height:56vh;background:#171a2b;color:#e7e9f3;' +
    'border:1px solid #2b2f45;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.45);' +
    'font:13px/1.45 "Segoe UI",Arial,sans-serif;z-index:2147483646;display:none;flex-direction:column;overflow:hidden';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#1f2338;font-weight:600';
  const title = document.createElement('span');
  title.innerHTML = '⚡ Answers <span id="jf-panel-count" style="opacity:.55;font-weight:400"></span>';
  const close = document.createElement('span');
  close.textContent = '×';
  close.title = 'Hide';
  close.style.cssText = 'cursor:pointer;font-size:18px;opacity:.7;padding:0 4px';
  close.onclick = () => { jfPanelEl.style.display = 'none'; };
  head.appendChild(title); head.appendChild(close);
  // Interactive review section (populated by the 🤖 button); hidden until used.
  jfReviewSection = document.createElement('div');
  jfReviewSection.style.cssText = 'display:none;border-bottom:2px solid #2b2f45;max-height:38vh;overflow-y:auto';
  jfPanelList = document.createElement('div');
  jfPanelList.style.cssText = 'overflow-y:auto;padding:2px 0';
  jfPanelEl.appendChild(head); jfPanelEl.appendChild(jfReviewSection); jfPanelEl.appendChild(jfPanelList);
  shadow.appendChild(jfPanelEl);
  jfPanelCount = jfPanelEl.querySelector('#jf-panel-count');
  return jfPanelEl;
}
// Log a question → answer pair. source: 'profile' | 'ai' | 'skip'.
function jfLogQA(question, answer, source) {
  question = (question || '').replace(/\s+/g, ' ').trim();
  if (!question) return;
  const sig = question.toLowerCase().slice(0, 80);
  if (jfPanelSeen.has(sig)) return;   // one row per question across the whole flow
  jfPanelSeen.add(sig);
  jfPanelBuild();
  jfPanelEl.style.display = 'flex';
  const s = JF_SRC[source] || JF_SRC.profile;
  const row = document.createElement('div');
  row.style.cssText = 'padding:8px 12px;border-bottom:1px solid #23273c';
  const q = document.createElement('div');
  q.textContent = question.length > 96 ? question.slice(0, 96) + '…' : question;
  q.style.cssText = 'opacity:.72;font-size:12px;margin-bottom:3px';
  const a = document.createElement('div');
  a.style.cssText = 'display:flex;align-items:baseline;gap:6px';
  const dot = document.createElement('span');
  dot.textContent = '●'; dot.style.color = s.c;
  const av = document.createElement('span');
  av.textContent = (answer && String(answer).trim()) || '—';
  av.style.cssText = 'font-weight:600;color:' + (answer ? '#e7e9f3' : '#f59e0b');
  const tag = document.createElement('span');
  tag.textContent = s.t; tag.style.cssText = 'opacity:.5;font-size:11px;margin-left:auto';
  a.appendChild(dot); a.appendChild(av); a.appendChild(tag);
  row.appendChild(q); row.appendChild(a);
  jfPanelList.appendChild(row);
  jfPanelList.scrollTop = jfPanelList.scrollHeight;
  if (jfPanelCount) jfPanelCount.textContent = '(' + jfPanelList.children.length + ')';
}

// ---- Cached profile so we fetch once, then reuse for auto-fill + manual ----
let JF_DATA = null;
async function jfGetData() {
  if (JF_DATA) return JF_DATA;
  // Ask the background service worker to fetch — a page on a public origin
  // (Greenhouse, Workday…) is blocked by Chrome's Private Network Access policy
  // from calling 127.0.0.1 directly, but the extension background is not.
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ action: 'fetchExtensionData' });
  } catch (e) {
    // Extension context invalidated (e.g. just reloaded) — fall back to a direct
    // fetch, which still works on same-origin/localhost pages like the app itself.
    const res = await fetch(JF_API);
    if (!res.ok) throw new Error('Server returned ' + res.status);
    JF_DATA = await res.json();
    return JF_DATA;
  }
  if (!resp || !resp.success) throw new Error((resp && resp.error) || 'server unreachable');
  JF_DATA = resp.data;
  return JF_DATA;
}

// ---- Does this page/frame look like a real application/signup form? ----
// Used to decide whether AUTO-fill should fire (conservative — we don't want to
// run on a random page's search box). Matches identity fields (page 1) OR the
// question/eligibility/EEO vocabulary of a later application STEP (page 2+),
// which has no name/email/resume field — that gap is exactly why iCIMS/Workday
// question pages used to be skipped entirely.
function jfLooksLikeForm() {
  const fields = deepQueryAll('input,textarea,select,[role="combobox"],[aria-haspopup="listbox"]');
  return fields.some((el) => {
    if (el.type === 'email') return true;
    const hay = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-automation-id')].filter(Boolean).join(' ');
    const both = hay + ' ' + (describe(el).label || '');
    return /mail|first[\s_-]*name|last[\s_-]*name|full[\s_-]*name|legal[\s_-]*name|resume|cover[\s_-]*letter|linked/i.test(both)
      || /gender|\bsex\b|\brace\b|ethnic|hispanic|latino|veteran|disab|demographic|self[\s_-]*identif/i.test(both)
      || /sponsor|\bvisa\b|authori[sz]ed to work|eligible to work|right to work|work (permit|authori)|relocat|salary requirement|desired (annual |base )?(salary|pay|compensation)|\b18 years\b|at least 18|require any immigration/i.test(both);
  });
}

// ---- Does this frame have ANY visible, fillable control? ----
// Looser than jfLooksLikeForm — used only when the user EXPLICITLY clicks ⚡ and
// we broadcast to every frame. An application step (iCIMS/Workday questions)
// lives in an embedded frame and often has none of the identity keywords above,
// so an explicit click must still be allowed to fill it.
function jfHasFillableFields() {
  const els = deepQueryAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]):not([type=password]):not([type=file]), ' +
    'textarea, select, [role="combobox"], [aria-haspopup="listbox"], input[type="radio"], input[type="checkbox"]'
  );
  return els.some((el) => {
    if (el.closest('#jf-floating-btn') || el.closest('#jf-panel')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  });
}

let jfBtn = null;
let jfBusy = false;        // suppress observer-triggered re-runs while we're clicking around
let jfTotalFilled = 0;     // cumulative across auto+manual runs on this page
let jfIdleRuns = 0;        // consecutive auto-runs that filled nothing new
let jfCooldownUntil = 0;   // ignore mutations right after our own fill
const jfDoneQuestions = new Set();  // dropdown questions already handled (survives React re-render)

function jfSetBtn(txt, revert) {
  if (!jfBtn) return;
  jfBtn.textContent = txt;
  if (revert) setTimeout(() => { if (jfBtn) jfBtn.textContent = '⚡'; }, 3500);
}

// ---- The one fill routine, used by both the button and auto-fill ----
async function jfRun(manual) {
  if (jfBusy) return 0;
  jfBusy = true;
  if (jfBtn && manual) { jfBtn.classList.add('filling'); jfBtn.textContent = '⏳'; }
  try {
    const data = await jfGetData();
    if (!data.profile || !data.profile.fullName) {
      if (manual) jfFlash('Your profile is empty. Open localhost:3000 → My Profile → fill and save.', '#f59e0b');
      jfSetBtn('⚡');
      return 0;
    }
    let n = await fillForm(data.profile, data.letter || '');
    // ⚡ NEVER calls the AI. On a manual click it also answers unclassified yes/no
    // COMPLIANCE questions from your saved default ("No") — no tokens spent. The
    // AI lives only behind the separate 🤖 review button (aiFill), where you pick
    // which questions to send.
    if (manual) { try { n += await fillComplianceDefaults(JFMatcher.buildProfile(data.profile)); } catch (e) { console.warn('[JobFlow] compliance pass:', e && e.message); } }
    jfTotalFilled += n;
    if (!manual) jfIdleRuns = (n > 0) ? 0 : (jfIdleRuns + 1);   // track no-progress auto-runs
    if (n > 0) {
      jfSetBtn('✅ ' + n, true);
      jfFlash((manual ? 'Filled ' : 'Auto-filled ') + n + ' field' + (n > 1 ? 's' : '') + ' (green). Review before submitting.', '#3ecf8e');
    } else if (manual) {
      jfSetBtn('∅', true);
      if (jfTotalFilled > 0) {
        jfFlash('Everything I can recognize is already filled (' + jfTotalFilled + ' so far). The remaining fields need answers I don\'t have — add them once in My Profile → Demographics if they repeat across applications.', '#6d8bff');
      } else {
        const hasIframes = document.querySelectorAll('iframe').length > 0;
        jfFlash(hasIframes
          ? 'The form on this step is inside an embedded frame — I asked it to fill directly. Watch for green (profile) and purple (AI) fields there; open the ⚡ answers panel to see what was set.'
          : 'No fillable fields found. If this is a job list page, open a job and click Apply first — then the form will fill.', hasIframes ? '#6d8bff' : '#f59e0b');
      }
    }
    return n;
  } catch (err) {
    JF_DATA = null; // allow retry after the server comes back
    if (manual) {
      jfSetBtn('❌', true);
      jfFlash('Cannot reach the JobFlow server. Start it with start-jobflow.bat (or npm start). ' + err.message, '#ff4d4f');
    }
    return 0;
  } finally {
    jfBusy = false;
    jfCooldownUntil = Date.now() + 1500;   // let our own DOM churn settle before re-checking
    if (jfBtn) jfBtn.classList.remove('filling');
  }
}

try {
  // Inject the button in the top page, or in any sub-frame that truly has fields
  const isTop = window.top === window;
  if (isTop || deepQueryAll('input,textarea,select', document).length > 0) {
    const old = document.getElementById('jf-floating-btn');
    if (old) old.remove();

    jfBtn = document.createElement('button');
    jfBtn.id = 'jf-floating-btn';
    jfBtn.textContent = '⚡';
    jfBtn.title = 'JobFlow Autofill — click to fill this form (auto-fills on load too)';
    document.body.appendChild(jfBtn);
    jfBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      jfRun(true);
      // Also trigger the fill in every other frame of this tab (Greenhouse
      // embeds and many ATS pages keep the real form inside an iframe).
      try { chrome.runtime.sendMessage({ action: 'fillAllFrames', nonce: JF_NONCE }); } catch (err) {}
    });

    // 🤖 — open the AI review panel (never sends until you press "Send").
    const oldAi = document.getElementById('jf-ai-btn');
    if (oldAi) oldAi.remove();
    const aiBtn = document.createElement('button');
    aiBtn.id = 'jf-ai-btn';
    aiBtn.textContent = '🤖';
    aiBtn.title = 'JobFlow — review which questions to send to the AI';
    document.body.appendChild(aiBtn);
    aiBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      jfRenderReview(collectAiCandidates());
      // Ask the frame(s) holding the real form to open their own review too.
      try { chrome.runtime.sendMessage({ action: 'reviewAllFrames', nonce: JF_NONCE }); } catch (err) {}
    });
  }

  // Receive fill broadcasts initiated from another frame's ⚡ button. This is an
  // EXPLICIT user action, so we fill any frame that has fillable controls — not
  // just ones with identity fields. That is what lets a click on the outer page
  // fill an application STEP (iCIMS/Workday questions) that lives in an iframe
  // and has no name/email/resume field of its own.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.action === 'jf-fill' && msg.nonce !== JF_NONCE) {
        if (jfHasFillableFields()) jfRun(true);
      }
      // 🤖 review broadcast — a frame with real questions opens its own panel.
      if (msg && msg.action === 'jf-review' && msg.nonce !== JF_NONCE) {
        if (jfHasFillableFields()) jfRenderReview(collectAiCandidates());
      }
    });
  } catch (err) {}

  // ---- AUTO-FILL: on load, and again whenever a new step/modal renders ----
  let autoTimer = null;
  let jfObs = null;
  const scheduleAuto = () => {
    if (jfBusy) return; // our own filling mutates the DOM — don't re-trigger
    // Stop auto-running once several passes in a row have filled nothing new —
    // that means we're chasing our own re-render churn, not real new fields.
    if (jfIdleRuns >= 4) { if (jfObs) { jfObs.disconnect(); jfObs = null; } return; }
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (jfBusy) return;
      if (Date.now() < jfCooldownUntil) { scheduleAuto(); return; } // still cooling down
      if (jfLooksLikeForm()) jfRun(false);
    }, 1200);
  };
  setTimeout(scheduleAuto, 1200);
  jfObs = new MutationObserver(scheduleAuto);
  jfObs.observe(document.documentElement, { childList: true, subtree: true });
} catch (initErr) {
  console.warn('[JobFlow] Init skipped:', initErr.message);
}

// Resolve a field's value. Education/work keys pull from the i-th resume entry,
// where i = how many times we've already seen that key (fields appear in entry
// order), so the 2nd "School" fills education entry 2, etc. entryCount is shared
// across the text/select and custom-dropdown passes.
function valueFor(key, P, entryCount) {
  if (JFMatcher.isEntryKey(key)) {
    const i = entryCount[key] || 0;
    entryCount[key] = i + 1;
    const list = JFMatcher.entryListFor(key, P);
    return JFMatcher.resolveEntry(key, list[i]);
  }
  return JFMatcher.resolveValue(key, P);
}

// =============================================
// MAIN FILL LOGIC — driven by JFMatcher (extension/matcher.js),
// which is verified against real captured forms in ats-samples/test.js.
// =============================================
async function fillForm(profile, letter) {
  if (typeof JFMatcher === 'undefined') {
    console.error('[JobFlow] matcher.js not loaded — check manifest content_scripts order');
    return 0;
  }
  const P = JFMatcher.buildProfile(profile);
  P.coverLetter = letter || '';
  const filledKeys = new Set();   // enforce single-fill for e.g. website
  const entryCount = {};          // per-key occurrence -> maps to resume entry index
  let n = 0;

  // ---- 1) TEXT INPUTS, TEXTAREAS, NATIVE SELECTS ----
  const els = deepQueryAll(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]):not([type=image]):not([type=reset]), textarea, select'
  );
  for (const el of els) {
    if (el.disabled || el.readOnly) continue;
    if (el.closest('#jf-floating-btn')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const isSelect = el.tagName === 'SELECT';
    if (!isSelect && el.value && el.value.trim()) continue;      // never overwrite
    if (isSelect && el.selectedIndex > 0) continue;
    // comboboxes handled in the custom-dropdown pass
    if (!isSelect && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox')) continue;

    const f = describe(el);
    const { key } = JFMatcher.classify(f);
    if (!key) continue;
    const val = valueFor(key, P, entryCount);
    if (!val) continue;
    if (JFMatcher.SINGLE_FILL.has(key)) { if (filledKeys.has(key)) continue; filledKeys.add(key); }

    if (isSelect) {
      if (selectOption(el, val, JFMatcher.kindFor(key))) n++;
    } else {
      setVal(el, val); n++;
    }
  }

  // ---- 2) RADIO BUTTONS & CHECKBOXES ----
  const choices = deepQueryAll('input[type="radio"], input[type="checkbox"]');
  for (const el of choices) {
    if (el.disabled || el.readOnly || el.checked) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const f = describe(el);
    const { key } = JFMatcher.classify(f);
    if (!key) continue;
    const val = valueFor(key, P, entryCount);
    if (!val) continue;
    // A consent/acknowledgement checkbox is a single box to tick — no yes/no
    // option to match against.
    const isConsent = key === 'consent' && el.type === 'checkbox';
    if (isConsent || JFMatcher.matchOption(val, f.optionText, JFMatcher.kindFor(key))) {
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (el.type === 'checkbox') el.style.outline = '2px solid #3ecf8e';
      n++;
    }
  }

  // ---- 3) CUSTOM DROPDOWNS (Greenhouse/Lever/Workday comboboxes) ----
  try { n += await fillCustomDropdowns(P, filledKeys, entryCount); }
  catch (e) { console.warn('[JobFlow] custom dropdown pass failed:', e); }

  return n;
}

// Open a custom combobox, wait for its listbox, click the matching option.
// Conservative: presses Escape and leaves it alone if nothing confidently matches.
async function fillCustomDropdowns(P, filledKeys, entryCount) {
  let n = 0;
  const triggers = deepQueryAll('[role="combobox"], [aria-haspopup="listbox"]');
  const seen = new Set();
  const sigCount = {};   // per-run occurrence of each question -> distinguishes repeated blocks
  for (const t of triggers) {
    if (seen.has(t)) continue; seen.add(t);
    if (t.closest('#jf-floating-btn')) continue;
    if (t.getAttribute('aria-disabled') === 'true' || t.disabled) continue;
    const r = t.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const current = ((t.value || '') + ' ' + (t.textContent || '')).trim();
    if (current && !/select|choose|make a selection|please|^[-–—\s.]*$/i.test(current)) continue;

    const f = describe(t);
    const { key } = JFMatcher.classify(f);
    if (!key) continue;
    const val = valueFor(key, P, entryCount);
    if (!val) continue;
    if (JFMatcher.SINGLE_FILL.has(key) && filledKeys.has(key)) continue;
    // Dedup by the question text (not the element) — React replaces the trigger
    // element on every re-render, so an element-keyed guard would loop forever.
    // Include an occurrence index so repeated blocks (2 "School"s) stay distinct.
    const sigBase = key + '|' + (f.label || f.idname || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const occ = (sigCount[sigBase] = (sigCount[sigBase] || 0) + 1);
    const sig = sigBase + '#' + occ;
    if (jfDoneQuestions.has(sig)) continue;
    jfDoneQuestions.add(sig);   // mark on attempt (even if no option matches) so we never re-open it
    const kind = JFMatcher.kindFor(key);

    // Each dropdown is isolated: if opening/selecting one throws (often the
    // site's OWN click/keydown handlers throwing, not us), skip it and move on
    // instead of aborting the whole pass.
    try {
      // Open the widget. react-select (Greenhouse/Lever) only opens when you hit
      // its CONTROL container or press ArrowDown — mousedown on the hidden input
      // does nothing, which is why demographics weren't filling.
      const control = t.closest('[class*="control"]') || t.closest('[class*="select__"]') || t.parentElement || t;
      if (typeof t.focus === 'function') t.focus();
      control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      control.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      if (typeof control.click === 'function' && control !== t) control.click();
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      const collect = () => deepQueryAll('[role="option"], li[class*="option"], div[class*="option"], [class*="select__option"]')
        .filter((o) => { const b = o.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
      // Wait for a synchronous menu to render; if none, type a query and wait for
      // async/remote results (Greenhouse Location searches over the network).
      let opts = await jfWaitForOptions(collect, 1500);
      if (!opts.length && t.tagName === 'INPUT') {
        const term = jfSearchTerm(val);
        if (term.length >= 3) { isolatedSetVal(t, term); opts = await jfWaitForOptions(collect, 2800); }
      }
      const hit = opts.find((o) => JFMatcher.matchOption(val, (o.textContent || '').toLowerCase(), kind));
      if (hit && await jfSelectOption(t, hit, collect)) {
        t.style.outline = '2px solid #3ecf8e';
        if (JFMatcher.SINGLE_FILL.has(key)) filledKeys.add(key);
        jfLogQA(f.label || f.idname, (hit.textContent || val).replace(/\s+/g, ' ').trim(), 'profile');
        n++;
        await sleep(150);
      } else {
        // Clear any typed query so a dangling async menu doesn't bleed into the
        // next field, then close the menu gently. Do NOT click document.body —
        // that runs the site's global handlers and surfaces their errors as ours.
        if (t.tagName === 'INPUT' && t.value) isolatedSetVal(t, '');
        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        if (typeof t.blur === 'function') t.blur();
        await sleep(80);
      }
    } catch (err) {
      console.warn('[JobFlow] dropdown skipped:', err && err.message);
    }
  }
  return n;
}

// Does this label read like a real yes/no question we should auto-answer with
// the default? Filters out combobox placeholders ("Start typing…"), option text
// ("Prefer not to answer"), and non-questions — so the compliance pass never
// mis-fills or mis-labels demographic / searchable dropdowns.
function jfIsYesNoQuestion(label) {
  const s = (label || '').replace(/\s+/g, ' ').trim();
  if (s.length < 8) return false;
  if (/^(start typing|select\b|choose\b|search\b|please select|make a selection|prefer not|decline|yes\b|no\b)/i.test(s)) return false;
  return /\?/.test(s)
    || /^(are|do|does|did|have|has|had|will|would|can|could|should|is|was|were|by (checking|clicking))\b/i.test(s)
    || /\b(are|do|have|will|can|would|did) you\b/i.test(s);
}

// =============================================
// COMPLIANCE PASS — answer unclassified Yes/No questions from the saved default
// ("No"), so trivial compliance questions (relatives employed, non-compete,
// previously employed…) never reach the paid AI. Only touches fields the matcher
// could NOT classify AND whose label reads like a yes/no question; a
// recognized-but-empty yes/no (e.g. age18) is left alone. Each fill is logged to
// the answers panel so it can be overridden before submit.
// =============================================
async function fillComplianceDefaults(P) {
  if (typeof JFMatcher === 'undefined') return 0;
  const def = P.complianceDefault || 'No';
  let n = 0;

  // ---- native <select> + radio groups ----
  const natives = deepQueryAll('select, input[type="radio"]');
  const radioSeen = new Set();
  for (const el of natives) {
    if (el.disabled || el.readOnly) continue;
    if (el.closest('#jf-floating-btn') || el.closest('#jf-panel')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const f = describe(el);
    if (JFMatcher.classify(f).key) continue;                 // rules own it → skip
    if (!jfIsYesNoQuestion(f.label)) continue;               // not a real yes/no question
    if (el.tagName === 'SELECT') {
      if (el.selectedIndex > 0) continue;                    // already answered
      const opts = [...el.options].map((o) => o.text);
      if (!JFMatcher.isYesNoOptions(opts)) continue;
      if (selectOption(el, def, 'yesno')) { jfLogQA(f.label || f.idname, def, 'compliance'); n++; }
    } else {
      const groupName = el.name || (f.label || '');
      if (radioSeen.has(groupName)) continue; radioSeen.add(groupName);
      const group = natives.filter((x) => x.type === 'radio' && (x.name || (describe(x).label || '')) === groupName);
      if (group.some((x) => x.checked)) continue;            // already answered
      const opts = group.map((x) => (describe(x).optionText || x.value || ''));
      if (!JFMatcher.isYesNoOptions(opts)) continue;
      const hit = group.find((x) => JFMatcher.matchOption(def, (describe(x).optionText || x.value || ''), 'yesno'));
      if (hit) {
        hit.click();
        hit.dispatchEvent(new Event('change', { bubbles: true }));
        hit.style.outline = '2px solid #f5a623';
        jfLogQA(f.label || f.idname, def, 'compliance'); n++;
      }
    }
  }

  // ---- custom comboboxes (open, and keep the pick only if a yes/no option matched) ----
  const combos = deepQueryAll('[role="combobox"], [aria-haspopup="listbox"]');
  const seen = new Set();
  for (const t of combos) {
    if (seen.has(t)) continue; seen.add(t);
    if (t.closest('#jf-floating-btn') || t.closest('#jf-panel')) continue;
    if (t.getAttribute('aria-disabled') === 'true' || t.disabled) continue;
    const rect = t.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const cur = ((t.value || '') + ' ' + (t.textContent || '')).trim();
    if (cur && !/select|choose|make a selection|please|^[-–—\s.]*$/i.test(cur)) continue;
    const f = describe(t);
    if (JFMatcher.classify(f).key) continue;
    if (!jfIsYesNoQuestion(f.label)) continue;   // skip placeholders / demographic comboboxes
    // openAndPickOption only selects when an option matches "No"; a factual
    // dropdown with no No/decline option is left untouched (returns false).
    if (await openAndPickOption(t, def, 'yesno', '#f5a623')) { jfLogQA(f.label || f.idname, def, 'compliance'); n++; }
  }
  return n;
}

// =============================================
// DOM → matcher field descriptor  (mirrors ats-samples/test.js toField)
// =============================================
function describe(el) {
  const isChoice = el.type === 'radio' || el.type === 'checkbox';
  const role = el.getAttribute('role');
  const haspopup = el.getAttribute('aria-haspopup');
  const spec = specificLabel(el);
  const cont = containerLabel(el);
  // A choice whose own label is SHORT ("Yes", "Male") is an option — its
  // question lives in the container. A choice with a full-sentence label
  // ("I currently work here", "I agree to…") is its own question.
  const shortOpt = spec && spec.split(/\s+/).length <= 3;
  // A combobox/select trigger often exposes its PLACEHOLDER or current value as
  // its accessible name ("Select One", "No") while the real QUESTION sits in the
  // container — Workday does exactly this, which is why eligibility/sponsorship
  // dropdowns were read as "Select One Required" and never recognized. Prefer the
  // container question when the trigger's name is just a placeholder, or when it
  // is a combobox with a short value name and the container reads as a question.
  const specClean = (spec || '').replace(/\s*\*?\s*required\s*$/i, '').trim();
  const isCombo = role === 'combobox' || role === 'listbox' || haspopup === 'listbox';
  // Only when the combobox's whole accessible name is a placeholder ("Select
  // One", "Choose…") do we fall back to the container question. A combobox with
  // a REAL name (e.g. "Data Privacy Consent") keeps it — that name is correct
  // and the container is often a polluted page heading.
  const specIsPlaceholder = /^(select\b|choose\b|please select|make a selection|pick one\b|--)/i.test(specClean);
  const preferContainer = !isChoice && cont && isCombo && specIsPlaceholder;
  return {
    idname: [el.name, el.id, el.getAttribute('data-automation-id'), el.getAttribute('data-testid'), el.getAttribute('data-field-name')].filter(Boolean).join(' '),
    label: isChoice ? (shortOpt ? (cont || spec) : spec) : (preferContainer ? cont : (spec || cont)),
    section: cont,
    optionText: isChoice ? spec : '',
    type: el.type,
    tag: el.tagName.toLowerCase(),
    role: role,
    haspopup: haspopup,
  };
}

function specificLabel(el) {
  const parts = [];
  if (el.id) {
    try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) parts.push(l.textContent); } catch (e) {}
  }
  const wrap = el.closest('label');
  if (wrap) parts.push(wrap.textContent);
  const al = el.getAttribute('aria-label'); if (al) parts.push(al);
  const lb = el.getAttribute('aria-labelledby');
  if (lb) lb.split(/\s+/).forEach((id) => { const node = document.getElementById(id); if (node) parts.push(node.textContent); });
  if (el.placeholder) parts.push(el.placeholder);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function containerLabel(el) {
  const c = el.closest('fieldset,[role=group],[role=radiogroup],.field,.form-group,.form-field,.application-question,.application-field,[class*=question],[data-automation-id]');
  if (!c) return '';
  const h = c.querySelector('legend,label,.label,[class*=label],[class*=question-text],[class*=question]');
  return ((h ? h.textContent : c.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// =============================================
// APPLY HELPERS
// =============================================
function setVal(el, v) {
  if (!v) return;
  el.style.outline = '2px solid #3ecf8e';
  // Prefer setting the value in the page's own JS context (main world) so the
  // site's framework treats it as genuine input. Falls back to isolated-world
  // setting if the main-world helper isn't present or didn't handle it.
  if (document.documentElement.getAttribute('data-jf-mainworld') === '1') {
    const token = 'jf' + Math.random().toString(36).slice(2);
    el.setAttribute('data-jf-token', token);
    document.dispatchEvent(new CustomEvent('__jf_set', { detail: { token, value: String(v) } }));
    if (el.getAttribute('data-jf-token') !== token) return;  // main world handled it (removed the tag)
    el.removeAttribute('data-jf-token');                     // not handled → fall through
  }
  isolatedSetVal(el, v);
}

function isolatedSetVal(el, v) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  const lastValue = el.value;
  if (desc && desc.set) desc.set.call(el, v); else el.value = v;
  const tracker = el._valueTracker;      // React controlled inputs
  if (tracker) tracker.setValue(lastValue);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function selectOption(sel, val, kind) {
  const texts = [...sel.options].map((o) => o.text);
  const idx = JFMatcher.pickOption(texts, val, kind);
  if (idx > 0) {
    sel.selectedIndex = idx;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.style.outline = '2px solid #3ecf8e';
    return true;
  }
  return false;
}

// Open a custom combobox and click the option matching `val`. Reusable by the
// rule pass and the AI pass. Returns true if it selected something.
async function openAndPickOption(t, val, kind, outline) {
  try {
    const control = t.closest('[class*="control"]') || t.closest('[class*="select__"]') || t.parentElement || t;
    if (typeof t.focus === 'function') t.focus();
    control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    control.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    if (typeof control.click === 'function' && control !== t) control.click();
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const collect = () => deepQueryAll('[role="option"], li[class*="option"], div[class*="option"], [class*="select__option"]')
      .filter((o) => { const b = o.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
    let opts = await jfWaitForOptions(collect, 1500);
    if (!opts.length && t.tagName === 'INPUT') {
      const term = jfSearchTerm(val);
      if (term.length >= 3) { isolatedSetVal(t, term); opts = await jfWaitForOptions(collect, 2800); }
    }
    const hit = opts.find((o) => JFMatcher.matchOption(val, (o.textContent || '').toLowerCase(), kind))
      || opts.find((o) => (o.textContent || '').toLowerCase().trim() === String(val).toLowerCase().trim());
    if (hit && await jfSelectOption(t, hit, collect)) {
      t.style.outline = '2px solid ' + (outline || '#3ecf8e');
      await sleep(120);
      return true;
    }
    // Clear any query we typed so a dangling async menu doesn't bleed into the
    // next field, then close the menu.
    if (t.tagName === 'INPUT' && t.value) isolatedSetVal(t, '');
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (typeof t.blur === 'function') t.blur();
    return false;
  } catch (e) { return false; }
}

// =============================================
// AI REVIEW — the 🤖 button collects the questions the rules couldn't answer,
// categorizes them, and shows a review panel where you tick which to send.
// NOTHING is sent to the model until you press "Send". Three parts:
// collectAiCandidates() → jfRenderReview() → jfSendSelected().
// =============================================
// Keys the rules own — never hand these to the AI.
const AI_EXCLUDE = /^(firstName|lastName|fullName|email|phone|linkedin|github|website|home|edu|work|referrerName|consent|pronouns|location)/;
let jfReviewCands = [];   // current review candidates (set by collectAiCandidates)

// Gather unanswered, non-profile, non-compliance questions as review candidates.
function collectAiCandidates() {
  if (typeof JFMatcher === 'undefined') return [];
  deepQueryAll('[data-jf-q]').forEach((e) => e.removeAttribute('data-jf-q')); // fresh each open
  const cands = [];
  let tok = 0;
  const add = (el, type, label, options, els) => {
    const category = JFMatcher.categorizeQuestion(describe(el || (els && els[0])), options || []);
    if (category === 'compliance') return;   // ⚡ answers these from your default, not the AI
    const token = 'q' + (tok++);
    cands.push({ token, el, els, type, category, label: (label || '').slice(0, 300), options: (options || []).slice(0, 30) });
    if (els) els.forEach((e) => e.setAttribute('data-jf-q', token)); else el.setAttribute('data-jf-q', token);
  };
  const eligible = (el) => { if (el.disabled || el.readOnly) return false; const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; };
  // The rules "own" a field — never pay the AI for it — when the matcher can
  // classify it AND we already hold a value (gender, race, veteran, salary, …).
  // The AI can only echo that same profile value, so asking is pure waste; the
  // rule/custom-dropdown pass fills it locally. Only genuinely unknown, open
  // questions reach the model.
  const P = JFMatcher.buildProfile((JF_DATA && JF_DATA.profile) || {});
  const ruleOwns = (el) => {
    const { key } = JFMatcher.classify(describe(el));
    if (!key) return false;
    if (AI_EXCLUDE.test(key)) return true;
    if (JFMatcher.isEntryKey(key)) return (JFMatcher.entryListFor(key, P) || []).length > 0;
    return !!JFMatcher.resolveValue(key, P);
  };

  // Open-ended text: empty textareas, or text inputs whose label is a real question
  deepQueryAll('textarea, input[type=text], input:not([type])').forEach((el) => {
    if (!eligible(el) || (el.value && el.value.trim())) return;
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('data-jf-q')) return;
    if (ruleOwns(el)) return;
    const label = (describe(el).label || '').trim();
    const isQ = el.tagName === 'TEXTAREA' || /\?/.test(label) || label.split(/\s+/).length >= 6;
    if (!label || label.length < 6 || !isQ) return;
    add(el, el.tagName === 'TEXTAREA' ? 'textarea' : 'text', label);
  });
  // Native selects still unset
  deepQueryAll('select').forEach((el) => {
    if (!eligible(el) || el.selectedIndex > 0 || el.getAttribute('data-jf-q')) return;
    if (ruleOwns(el)) return;
    const label = (describe(el).label || '').trim();
    const opts = [...el.options].map((o) => o.text.trim()).filter(Boolean);
    if (!label || opts.length < 2) return;
    add(el, 'select', label, opts);
  });
  // Custom comboboxes still on the placeholder
  deepQueryAll('[role="combobox"], [aria-haspopup="listbox"]').forEach((el) => {
    if (!eligible(el) || el.getAttribute('data-jf-q')) return;
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return;
    const cur = ((el.value || '') + ' ' + (el.textContent || '')).trim();
    if (cur && !/select|choose|make a selection|please|^[-–—\s.]*$/i.test(cur)) return;
    if (ruleOwns(el)) return;
    const label = (describe(el).label || '').trim();
    if (!label) return;
    add(el, 'combobox', label);
  });
  // Radio groups with nothing chosen
  const groups = {};
  deepQueryAll('input[type="radio"]').forEach((el) => {
    if (!eligible(el)) return;
    const q = (describe(el).label || '').trim();
    if (!q) return;
    (groups[q] = groups[q] || []).push(el);
  });
  Object.keys(groups).forEach((q) => {
    const els = groups[q];
    if (els.some((e) => e.checked) || els[0].getAttribute('data-jf-q')) return;
    if (ruleOwns(els[0])) return;
    const opts = els.map((e) => (describe(e).optionText || e.value || '').trim()).filter(Boolean);
    if (q.length < 6 || !opts.length) return;
    add(null, 'radio', q, opts, els);
  });

  return cands;
}

// Render the review panel at the top of the answers panel: one row per
// candidate, essays pre-checked, factual dropdowns / short answers unchecked.
function jfRenderReview(cands) {
  jfReviewCands = cands || [];
  jfPanelBuild();
  jfPanelEl.style.display = 'flex';
  const sec = jfReviewSection;
  sec.style.display = 'block';
  sec.innerHTML = '';
  if (!jfReviewCands.length) {
    const none = document.createElement('div');
    none.style.cssText = 'padding:12px;opacity:.8;font-size:12px';
    none.textContent = 'Nothing needs the AI — everything is filled from your profile.';
    sec.appendChild(none);
    setTimeout(() => { if (jfReviewSection) jfReviewSection.style.display = 'none'; }, 4500);
    return;
  }
  const head = document.createElement('div');
  head.style.cssText = 'padding:8px 12px;font-weight:600;background:#20233a;font-size:13px';
  head.textContent = 'To answer with AI — tick what to send';
  sec.appendChild(head);

  const rows = document.createElement('div');
  sec.appendChild(rows);
  const updateCount = () => {
    const nsel = jfReviewCands.filter((x) => x._send).length;
    send.textContent = nsel ? ('Send ' + nsel + ' to AI →') : 'Select at least one';
    send.disabled = nsel === 0;
    send.style.opacity = nsel ? '1' : '.5';
  };
  jfReviewCands.forEach((c) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid #23273c;cursor:pointer;align-items:flex-start';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = c.category === 'essay';
    c._send = cb.checked;
    cb.style.marginTop = '3px';
    cb.onchange = () => { c._send = cb.checked; updateCount(); };
    const body = document.createElement('div');
    const q = document.createElement('div');
    q.textContent = c.label.length > 110 ? c.label.slice(0, 110) + '…' : c.label;
    q.style.cssText = 'font-size:12px;margin-bottom:2px';
    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;opacity:.55';
    const badge = c.category === 'essay' ? 'essay' : (c.category === 'multi' ? 'dropdown' : 'short answer');
    meta.textContent = badge + (c.options && c.options.length ? ' · ' + c.options.slice(0, 6).join(', ') : '');
    body.appendChild(q); body.appendChild(meta);
    row.appendChild(cb); row.appendChild(body);
    rows.appendChild(row);
  });

  const foot = document.createElement('div');
  foot.style.cssText = 'display:flex;gap:8px;padding:10px 12px;position:sticky;bottom:0;background:#171a2b';
  const send = document.createElement('button');
  send.style.cssText = 'flex:1;background:linear-gradient(135deg,#8b7dff,#6d8bff);color:#fff;border:none;border-radius:8px;padding:8px;font-weight:600;cursor:pointer';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.style.cssText = 'background:#2b2f45;color:#e7e9f3;border:none;border-radius:8px;padding:8px 12px;cursor:pointer';
  cancel.onclick = () => { jfReviewSection.style.display = 'none'; };
  send.onclick = () => { if (jfReviewCands.some((x) => x._send)) jfSendSelected(); };
  foot.appendChild(send); foot.appendChild(cancel);
  sec.appendChild(foot);
  updateCount();
}

// Send the ticked candidates in ONE batched gptFill call, then fill answers back.
async function jfSendSelected() {
  const chosen = jfReviewCands.filter((c) => c._send);
  if (!chosen.length) return;
  const questions = chosen.map((c) => {
    const q = { id: c.token, label: c.label, type: c.type };
    if (c.options && c.options.length) q.options = c.options;
    return q;
  });
  jfReviewSection.style.display = 'none';
  jfFlash('Asking AI to answer ' + chosen.length + ' question' + (chosen.length > 1 ? 's' : '') + '…', '#8b7dff');
  let resp;
  try { resp = await chrome.runtime.sendMessage({ action: 'gptFill', questions }); }
  catch (e) { jfFlash('AI call failed — is the JobFlow server running? ' + e.message, '#ff4d4f'); return; }
  if (!resp || !resp.success) { jfFlash('AI error: ' + ((resp && resp.error) || 'unknown'), '#ff4d4f'); return; }
  const data = resp.data || {};
  if (data.disabled) { jfFlash('Turn on API mode + add a key in Settings → AI to let it answer questions.', '#f59e0b'); return; }
  if (data.error) { jfFlash('AI: ' + data.error, '#ff4d4f'); return; }

  const byToken = {};
  chosen.forEach((c) => { byToken[c.token] = c; });
  const answeredIds = new Set();
  let filled = 0;
  for (const a of (data.answers || [])) {
    if (!a) continue;
    answeredIds.add(a.id);
    const c = byToken[a.id];
    if (!c) continue;
    if (!a.answer || !String(a.answer).trim()) { jfLogQA(c.label, '', 'skip'); continue; }
    const ans = String(a.answer);
    let ok = false;
    try {
      if (c.type === 'text' || c.type === 'textarea') { setVal(c.el, ans); ok = true; }
      else if (c.type === 'select') { ok = selectOption(c.el, ans, null); }
      else if (c.type === 'combobox') { ok = await openAndPickOption(c.el, ans, null, '#8b7dff'); }
      else if (c.type === 'radio') {
        const hit = c.els.find((e) => {
          const ot = (describe(e).optionText || e.value || '').toLowerCase();
          return JFMatcher.matchOption(ans, ot, null) || ot === ans.toLowerCase() || ot.includes(ans.toLowerCase());
        });
        if (hit) { hit.click(); hit.dispatchEvent(new Event('change', { bubbles: true })); hit.style.outline = '2px solid #8b7dff'; ok = true; }
      }
    } catch (e) { /* skip this answer */ }
    if (ok) filled++;
    jfLogQA(c.label, ok ? ans : '', ok ? 'ai' : 'skip');
  }
  chosen.forEach((c) => { if (!answeredIds.has(c.token)) jfLogQA(c.label, '', 'skip'); });
  if (filled > 0) jfFlash('✨ AI answered ' + filled + ' question' + (filled > 1 ? 's' : '') + ' (purple) — review before submitting!', '#8b7dff');
}
