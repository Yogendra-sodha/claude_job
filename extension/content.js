// JobFlow Autofill — Content Script
// Fetches profile data from the local JobFlow server and fills the current form.

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
    return /mail|first[\s_-]*name|last[\s_-]*name|full[\s_-]*name|legal[\s_-]*name|resume|cover[\s_-]*letter|linked[\s_-]*in/i.test(getDesc(el));
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
        jfFlash('Everything I can recognize is already filled (' + jfTotalFilled + ' so far). The remaining fields need answers I don\'t have — fill them once in My Profile → Demographics if they repeat across applications.', '#6d8bff');
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
// MAIN FILL LOGIC
// =============================================
async function fillForm(p, letter) {
  const parts = (p.fullName || '').trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';

  let d = {};
  try {
    if (typeof p.demographics === 'string' && p.demographics.length > 2) {
      d = JSON.parse(p.demographics);
    } else if (typeof p.demographics === 'object' && p.demographics !== null) {
      d = p.demographics;
    }
  } catch (e) { console.warn('[JobFlow] demographics parse error', e); }

  // Derive a yes/no for "Are you Hispanic/Latino?" from the race answer
  let hispanic = d.hispanic || '';
  if (!hispanic && d.race) {
    if (/not hispanic/i.test(d.race)) hispanic = 'no';
    else if (/hispanic|latino/i.test(d.race)) hispanic = 'yes';
  }

  // Personal-address values must NOT land in Education / Work History sections
  const NOT_EDU_WORK = /school|education|university|college|degree|work[\s_-]*history|employment|employer|company/i;
  // The generic name catch-all must never hit these
  const NOT_PERSON_NAME = /company|employer|school|university|college|institution|organi[sz]ation|business|reference|emergency|manager|recruiter|bank|branch/i;

  // ---- TEXT INPUT RULES: [regex, value, guard(desc) -> false to skip] ----
  const rules = [
    [/first[\s_-]*name|given[\s_-]*name|\bfname\b/i, first, (t) => !NOT_PERSON_NAME.test(t)],
    [/last[\s_-]*name|family[\s_-]*name|surname|\blname\b/i, last, (t) => !NOT_PERSON_NAME.test(t)],
    [/full[\s_-]*name|your[\s_-]*name|candidate[\s_-]*name|legal[\s_-]*name/i, p.fullName, (t) => !NOT_PERSON_NAME.test(t)],
    [/e[\s_-]*mail/i, p.email],
    [/phone|mobile|cell|contact[\s_-]*number|\btel\b/i, p.phone],
    [/pronoun/i, d.pronouns || ''],
    [/address[\s_-]*line[\s_-]*2|apt|suite|unit\b/i, d.address2 || '', (t) => !NOT_EDU_WORK.test(t)],
    [/address[\s_-]*line[\s_-]*1|street[\s_-]*address|\baddress\b/i, d.address1 || '', (t) => !NOT_EDU_WORK.test(t)],
    [/\bcity\b|\btown\b/i, d.city || '', (t) => !NOT_EDU_WORK.test(t)],
    [/\bstate\b|province/i, d.state || '', (t) => !NOT_EDU_WORK.test(t)],
    [/\bzip\b|postal/i, d.zip || '', (t) => !NOT_EDU_WORK.test(t)],
    [/\bcountry\b/i, d.country || '', (t) => !NOT_EDU_WORK.test(t) && !/county/i.test(t)],
    [/\blocation\b/i, p.location, (t) => !NOT_EDU_WORK.test(t)],
    [/linked[\s_-]*in/i, p.linkedin],
    [/\bgithub\b/i, d.github || p.portfolio || ''],
    [/website|portfolio|personal[\s_-]*site/i, d.website || p.portfolio || ''],
    [/years?[\s_-]*(of[\s_-]*)?experience/i, p.years],
    [/highest.*education|education[\s_-]*level|degree[\s_-]*level/i, d.edu_level || ''],
    [/university|college|institution|school[\s_-]*name|\bschool\b/i, d.university || ''],
    [/major|field[\s_-]*of[\s_-]*study|area[\s_-]*of[\s_-]*study/i, d.major || ''],
    [/\bdegree\b/i, d.degree || ''],
    [/\bgpa\b|grade[\s_-]*point/i, d.gpa || ''],
    [/salary|compensation|desired[\s_-]*pay|expected[\s_-]*pay/i, d.salary || ''],
    [/notice[\s_-]*period|start[\s_-]*date|earliest|when[\s_-]*can[\s_-]*you[\s_-]*start|available[\s_-]*to[\s_-]*start|looking[\s_-]*to[\s_-]*start|availability|start[\s_-]*a[\s_-]*(new[\s_-]*)?position/i, d.notice || ''],
    [/how[\s_-]*did[\s_-]*you[\s_-]*(hear|find|learn)|referral[\s_-]*source|\bsource\b/i, d.source || ''],
    [/\bsummary\b|about[\s_-]*(you|yourself|me)/i, p.summary || ''],
    [/\btitle\b|current[\s_-]*title|job[\s_-]*title/i, p.title || '', (t) => !NOT_EDU_WORK.test(t) || /job[\s_-]*title/i.test(t)],
    // Catch-all "name" LAST, guarded so it never fills company/school/reference names
    [/\bname\b/i, p.fullName, (t) => !NOT_PERSON_NAME.test(t)],
  ];

  // ---- DEMOGRAPHIC RULES: [regex, value, kind] (kind powers semantic matching) ----
  const demoRules = [
    [/\bgender\b|\bsex\b/i, d.gender || '', 'gender'],
    [/hispanic|latino/i, hispanic, 'yesno'],
    [/race|ethni/i, d.race || '', 'race'],
    [/veteran/i, d.veteran || '', 'veteran'],
    [/disabil/i, d.disability || '', 'disability'],
    [/18[\s_-]*years|over[\s_-]*18|at[\s_-]*least[\s_-]*18|legal[\s_-]*age|older\b/i, d.age18 || '', 'yesno'],
    [/may[\s_-]*we[\s_-]*contact|contact[\s_-]*(your[\s_-]*)?(current|past|previous|former)[\s_-]*(employer|supervisor)/i, d.contact_emp || '', 'yesno'],
    [/sponsor|visa/i, d.sponsorship || '', 'yesno'],
    [/authori[sz]ed[\s_-]*to[\s_-]*work|legally[\s_-]*authori|eligible[\s_-]*to[\s_-]*work|right[\s_-]*to[\s_-]*work|work[\s_-]*(permit|authori)/i, d.authorized || '', 'yesno'],
    [/relocat|willing[\s_-]*to[\s_-]*(move|transfer)/i, d.relocate || '', 'yesno'],
    [/previously[\s_-]*(employed|worked)|employed[\s_-]*(by|at|with)|worked[\s_-]*(here|for[\s_-]*us)|former[\s_-]*employee/i, d.prev_emp || '', 'yesno'],
    [/non[\s_-]*compete|confidentiality|restrictive/i, d.noncompete || '', 'yesno'],
  ];

  const ruleValue = (desc, ruleList) => {
    for (const r of ruleList) {
      const [re, val, guard] = r;
      if (!val) continue;
      if (!re.test(desc)) continue;
      if (guard && !guard(desc)) continue;
      return r;
    }
    return null;
  };

  let n = 0;

  // 1) TEXT INPUTS & TEXTAREAS
  const inputs = deepQueryAll(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]):not([type=image]):not([type=reset]), textarea'
  );

  for (const el of inputs) {
    if (el.disabled || el.readOnly) continue;
    if (el.value && el.value.trim()) continue;
    if (el.closest('#jf-floating-btn')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // Skip combobox-style inputs here; handled in the custom-dropdown pass
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') continue;

    if (el.type === 'email' && p.email) { setVal(el, p.email); n++; continue; }
    if (el.type === 'tel' && p.phone) { setVal(el, p.phone); n++; continue; }
    if (el.type === 'url') {
      const ud = getDesc(el);
      if (/linked/i.test(ud) && p.linkedin) { setVal(el, p.linkedin); n++; continue; }
      if (/github/i.test(ud) && (d.github || p.portfolio)) { setVal(el, d.github || p.portfolio); n++; continue; }
      if (d.website || p.portfolio) { setVal(el, d.website || p.portfolio); n++; continue; }
    }

    if (el.tagName === 'TEXTAREA' && letter) {
      const td = getDesc(el);
      if (/cover[\s_-]*letter|why[\s_-]*(do|are)[\s_-]*you|motivation|interest/i.test(td)) {
        setVal(el, letter); n++; continue;
      }
    }

    const desc = getDesc(el);
    const hit = ruleValue(desc, rules);
    if (hit) { setVal(el, hit[1]); n++; }
  }

  // 2) NATIVE <SELECT> DROPDOWNS
  const selects = deepQueryAll('select');
  for (const sel of selects) {
    if (sel.disabled) continue;
    if (sel.selectedIndex > 0) continue;
    const r = sel.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const desc = getDesc(sel);
    const hit = ruleValue(desc, rules);
    if (hit && selectByValue(sel, hit[1], null)) { n++; continue; }
    if (sel.selectedIndex <= 0) {
      const dh = ruleValue(desc, demoRules);
      if (dh && selectByValue(sel, dh[1], dh[2])) n++;
    }
  }

  // 3) RADIO BUTTONS & CHECKBOXES
  const radios = deepQueryAll('input[type="radio"], input[type="checkbox"]');
  for (const el of radios) {
    if (el.disabled || el.readOnly || el.checked) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const qText = getQuestionText(el);
    const optText = getOptionText(el);

    for (const [re, val, kind] of demoRules) {
      if (!val) continue;
      if (!re.test(qText)) continue;
      if (matchOption(val, optText, kind)) {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        n++;
        break;
      }
    }
  }

  // 4) CUSTOM DROPDOWNS (Greenhouse/Lever/Workday comboboxes — not native selects)
  try {
    n += await fillCustomDropdowns(rules, demoRules, ruleValue);
  } catch (e) { console.warn('[JobFlow] custom dropdown pass failed:', e); }

  return n;
}

// Custom combobox filler: open the widget, wait for its listbox, click the
// matching option. Conservative: if no option confidently matches, press
// Escape and leave it untouched.
async function fillCustomDropdowns(rules, demoRules, ruleValue) {
  let n = 0;
  const triggers = deepQueryAll('[role="combobox"], [aria-haspopup="listbox"]');
  const seen = new Set();
  for (const t of triggers) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (t.id === 'jf-floating-btn' || t.closest('#jf-floating-btn')) continue;
    if (t.getAttribute('aria-disabled') === 'true' || t.disabled) continue;
    const r = t.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Skip if it already shows a real choice
    const current = ((t.value || '') + ' ' + (t.textContent || '')).trim();
    if (current && !/select|choose|make a selection|please|^[-–—\s.]*$/i.test(current)) continue;

    const desc = getDesc(t) + ' ' + getQuestionText(t);
    let want = null, kind = null;
    const dh = ruleValue(desc, demoRules);
    if (dh) { want = dh[1]; kind = dh[2]; }
    else {
      const h = ruleValue(desc, rules);
      if (h) { want = h[1]; }
    }
    if (!want) continue;

    // Open the widget
    t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    if (typeof t.click === 'function') t.click();
    await sleep(350);

    // Find visible options (in the page or in a portal appended to <body>)
    const opts = deepQueryAll('[role="option"], li[class*="option"], div[class*="option"], [class*="select__option"]')
      .filter((o) => { const b = o.getBoundingClientRect(); return b.width > 0 && b.height > 0; });

    const hit = opts.find((o) => matchOption(want, (o.textContent || '').toLowerCase(), kind));
    if (hit) {
      hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      if (typeof hit.click === 'function') hit.click();
      t.style.outline = '2px solid #3ecf8e';
      n++;
      await sleep(200);
    } else {
      // Close without choosing anything
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body && document.body.click();
      await sleep(100);
    }
  }
  return n;
}

// =============================================
// HELPERS
// =============================================

function setVal(el, v) {
  if (!v) return;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  const lastValue = el.value;
  if (desc && desc.set) {
    desc.set.call(el, v);
  } else {
    el.value = v;
  }
  // Make React's controlled-input tracker register the change (must run AFTER
  // the native setter and use the PREVIOUS value, or React reverts the field).
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue(lastValue);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.style.outline = '2px solid #3ecf8e';
}

function selectByValue(sel, v, kind) {
  if (!v) return false;
  const vNorm = v.toLowerCase().replace(/[^a-z0-9]/g, '');
  let bestIdx = -1, bestScore = 0;

  for (let i = 1; i < sel.options.length; i++) {
    const oText = (sel.options[i].text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const oVal = (sel.options[i].value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (oVal === vNorm || oText === vNorm) { bestIdx = i; break; }
    if (oText.includes(vNorm) || vNorm.includes(oText)) {
      const score = Math.min(oText.length, vNorm.length);
      if (score > bestScore && score > 2) { bestScore = score; bestIdx = i; }
    }
  }
  // Semantic fallback for demographic-style questions ("No" -> "I am not a protected veteran")
  if (bestIdx < 0 && kind) {
    for (let i = 1; i < sel.options.length; i++) {
      if (matchOption(v, (sel.options[i].text || '').toLowerCase(), kind)) { bestIdx = i; break; }
    }
  }
  if (bestIdx > 0) {
    sel.selectedIndex = bestIdx;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.style.outline = '2px solid #3ecf8e';
    return true;
  }
  return false;
}

function getDesc(el) {
  let desc = [
    el.name, el.id, el.placeholder,
    el.getAttribute('aria-label'),
    el.getAttribute('autocomplete'),
    el.getAttribute('data-automation-id'),
    el.getAttribute('data-testid'),
    el.getAttribute('data-field-name'),
  ].filter(Boolean).join(' ');

  if (el.id) {
    try {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) desc += ' ' + lbl.textContent;
    } catch (e) {}
  }
  const wrap = el.closest('label');
  if (wrap) desc += ' ' + wrap.textContent;
  // Container-provided labels (Greenhouse .field, Lever .application-question, iCIMS blocks…)
  const parent = el.closest('.field, .form-group, .form-field, .application-question, .application-field, [class*="question"], [class*="form-item"], [data-automation-id]');
  if (parent) {
    const lbl = parent.querySelector('label, legend, .label, [class*="label"], [class*="question-text"]');
    if (lbl && !desc.includes(lbl.textContent.trim())) desc += ' ' + lbl.textContent;
  }
  // Split camelCase so word-boundary patterns work on ids like "addressCity"/"countryId"
  return desc.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function getQuestionText(el) {
  let text = el.name || '';
  const group = el.closest('fieldset, [role="group"], [role="radiogroup"], .form-group, .application-question, .application-field, .question-container, [class*="question"], [data-automation-id]');
  if (group) {
    const heading = group.querySelector('legend, h1, h2, h3, h4, h5, .question-text, [class*="question"], [class*="label"], label');
    text += ' ' + (heading ? heading.textContent : group.textContent.substring(0, 400));
  } else {
    let parent = el.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      if (parent.textContent.length > 10 && parent.textContent.length < 500) {
        text += ' ' + parent.textContent;
        break;
      }
      parent = parent.parentElement;
    }
  }
  return text.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2');
}

function getOptionText(el) {
  let text = el.value || '';
  if (el.id) {
    try {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) text += ' ' + lbl.textContent;
    } catch (e) {}
  }
  const wrap = el.closest('label');
  if (wrap) text += ' ' + wrap.textContent;
  return text.toLowerCase();
}

// Semantic option matching. kind sharpens yes/no style questions:
//  veteran:   "no" -> "I am not a protected veteran", "yes" -> "I identify as…"
//  disability:"no" -> "No, I do not have…", "yes" -> "Yes, I have…"
//  yesno:     plain yes/no plus decline variants
function matchOption(savedVal, optionText, kind) {
  const sv = (savedVal || '').toLowerCase().trim();
  const ot = (optionText || '').trim();
  if (!sv || !ot) return false;

  const declineRe = /decline|prefer[\s_-]*not|don.?t[\s_-]*wish|do[\s_-]*not[\s_-]*wish|no[\s_-]*answer/i;
  const svIsNo = /^no\b|^not\b|not[\s_-]*a[\s_-]*|don.?t|do[\s_-]*not/i.test(sv) && !declineRe.test(sv);
  const svIsYes = /^yes\b|^i[\s_-]*(am|do|have|identify)\b/i.test(sv) && !/not/i.test(sv);
  const svIsDecline = declineRe.test(sv);

  // Decline matches decline everywhere
  if (svIsDecline) return declineRe.test(ot);
  if (declineRe.test(ot)) return false; // never pick a decline option unless asked to

  if (kind === 'veteran') {
    if (svIsNo) return /not[\s_-]*a[\s_-]*(protected[\s_-]*)?veteran|i[\s_-]*am[\s_-]*not/i.test(ot);
    if (svIsYes) return /identify[\s_-]*as|one[\s_-]*or[\s_-]*more|is[\s_-]*a[\s_-]*protected/i.test(ot) && !/not/i.test(ot);
  }
  if (kind === 'disability') {
    if (svIsNo) return /^no\b|no,|do(n.?t| not)[\s_-]*have/i.test(ot);
    if (svIsYes) return /^yes\b|yes,|i[\s_-]*have/i.test(ot);
  }
  if (kind === 'yesno' || kind === 'veteran' || kind === 'disability') {
    if (svIsYes) return /\byes\b|\btrue\b/i.test(ot) && !/\bno\b/i.test(ot.slice(0, 4));
    if (svIsNo) return /\bno\b|\bfalse\b/i.test(ot) && !/\bnot[\s_-]*(applicable|wish)/i.test(ot) && !/\byes\b/i.test(ot.slice(0, 5));
  }

  // Generic: exact / contains on normalized strings
  if (sv === 'yes') return /\byes\b|\btrue\b/i.test(ot);
  if (sv === 'no') return /\bno\b|\bfalse\b/i.test(ot) && !/\bnot\b/i.test(ot);
  const svN = sv.replace(/[^a-z0-9]/g, '');
  const otN = ot.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (svN === otN) return true;
  if (svN.length > 3 && otN.length > 3) {
    if (otN.includes(svN) || svN.includes(otN)) return true;
  }
  return false;
}
