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
      if (e.shadowRoot) deepQueryAll(selector, e.shadowRoot, out);
    });
  } catch (e) { /* detached/cross-origin — skip */ }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    'position:fixed;bottom:80px;right:20px;max-width:280px;background:#171a2b;color:#e7e9f3;' +
    'border-left:4px solid ' + (color || '#6d8bff') + ';padding:12px 14px;border-radius:10px;' +
    'font:13px/1.5 "Segoe UI",Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);' +
    'z-index:2147483647;opacity:1;transition:opacity .4s';
  clearTimeout(f._t);
  f._t = setTimeout(() => { f.style.opacity = '0'; }, 6000);
}

// ---- Cached profile so we fetch once, then reuse for auto-fill + manual ----
let JF_DATA = null;
async function jfGetData() {
  if (JF_DATA) return JF_DATA;
  const res = await fetch(JF_API);
  if (!res.ok) throw new Error('Server returned ' + res.status);
  JF_DATA = await res.json();
  return JF_DATA;
}

// ---- Does this page/frame look like a real application/signup form? ----
function jfLooksLikeForm() {
  const fields = deepQueryAll('input,textarea,select');
  return fields.some((el) => {
    if (el.type === 'email') return true;
    const hay = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-automation-id')].filter(Boolean).join(' ');
    return /mail|first[\s_-]*name|last[\s_-]*name|full[\s_-]*name|legal[\s_-]*name|resume|cover[\s_-]*letter|linked/i.test(hay);
  });
}

let jfBtn = null;
let jfBusy = false;        // suppress observer-triggered re-runs while we're clicking around
let jfTotalFilled = 0;     // cumulative across auto+manual runs on this page

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
    const n = await fillForm(data.profile, data.letter || '');
    jfTotalFilled += n;
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
          ? 'This part of the page has no form — it lives in an embedded frame, which I also asked to fill. If nothing turned green, open a specific job and click Apply first.'
          : 'No fillable fields found. If this is a job list page, open a job and click Apply first — then the form will fill.', '#f59e0b');
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
  }

  // Receive fill broadcasts initiated from another frame's ⚡ button
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.action === 'jf-fill' && msg.nonce !== JF_NONCE) {
        if (jfLooksLikeForm()) jfRun(true);
      }
    });
  } catch (err) {}

  // ---- AUTO-FILL: on load, and again whenever a new step/modal renders ----
  let autoTimer = null;
  const scheduleAuto = () => {
    if (jfBusy) return; // our own filling mutates the DOM — don't re-trigger
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { if (!jfBusy && jfLooksLikeForm()) jfRun(false); }, 1000);
  };
  setTimeout(scheduleAuto, 1200);
  const obs = new MutationObserver(scheduleAuto);
  obs.observe(document.documentElement, { childList: true, subtree: true });
} catch (initErr) {
  console.warn('[JobFlow] Init skipped:', initErr.message);
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
  const filledKeys = new Set();   // enforce single-fill for repeated edu/work blocks
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
    const val = JFMatcher.resolveValue(key, P);
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
    const val = JFMatcher.resolveValue(key, P);
    if (!val) continue;
    if (JFMatcher.matchOption(val, f.optionText, JFMatcher.kindFor(key))) {
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      n++;
    }
  }

  // ---- 3) CUSTOM DROPDOWNS (Greenhouse/Lever/Workday comboboxes) ----
  try { n += await fillCustomDropdowns(P, filledKeys); }
  catch (e) { console.warn('[JobFlow] custom dropdown pass failed:', e); }

  return n;
}

// Open a custom combobox, wait for its listbox, click the matching option.
// Conservative: presses Escape and leaves it alone if nothing confidently matches.
async function fillCustomDropdowns(P, filledKeys) {
  let n = 0;
  const triggers = deepQueryAll('[role="combobox"], [aria-haspopup="listbox"]');
  const seen = new Set();
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
    const val = JFMatcher.resolveValue(key, P);
    if (!val) continue;
    if (JFMatcher.SINGLE_FILL.has(key) && filledKeys.has(key)) continue;
    const kind = JFMatcher.kindFor(key);

    t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    if (typeof t.click === 'function') t.click();
    await sleep(350);

    const opts = deepQueryAll('[role="option"], li[class*="option"], div[class*="option"], [class*="select__option"]')
      .filter((o) => { const b = o.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
    const hit = opts.find((o) => JFMatcher.matchOption(val, (o.textContent || '').toLowerCase(), kind));
    if (hit) {
      hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      if (typeof hit.click === 'function') hit.click();
      t.style.outline = '2px solid #3ecf8e';
      if (JFMatcher.SINGLE_FILL.has(key)) filledKeys.add(key);
      n++;
      await sleep(200);
    } else {
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (document.body) document.body.click();
      await sleep(80);
    }
  }
  return n;
}

// =============================================
// DOM → matcher field descriptor  (mirrors ats-samples/test.js toField)
// =============================================
function describe(el) {
  const isChoice = el.type === 'radio' || el.type === 'checkbox';
  const spec = specificLabel(el);
  const cont = containerLabel(el);
  return {
    idname: [el.name, el.id, el.getAttribute('data-automation-id'), el.getAttribute('data-testid'), el.getAttribute('data-field-name')].filter(Boolean).join(' '),
    // radios/checkboxes: question is in the container, option is the specific label
    label: isChoice ? (cont || spec) : (spec || cont),
    section: cont,
    optionText: isChoice ? spec : '',
    type: el.type,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
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
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  const lastValue = el.value;
  if (desc && desc.set) desc.set.call(el, v); else el.value = v;
  const tracker = el._valueTracker;      // React controlled inputs
  if (tracker) tracker.setValue(lastValue);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.style.outline = '2px solid #3ecf8e';
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
