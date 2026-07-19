// JobFlow Autofill — Content Script
// Fetches profile data from the local JobFlow server and fills the current form.

const JF_API = 'http://127.0.0.1:3000/api/data/extension';

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
  f._t = setTimeout(() => { f.style.opacity = '0'; }, 5000);
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
// Requires an identity field so we don't auto-fill random search boxes.
function jfLooksLikeForm() {
  const fields = deepQueryAll('input,textarea,select');
  return fields.some((el) => {
    if (el.type === 'email') return true;
    return /mail|first[\s_-]*name|last[\s_-]*name|full[\s_-]*name|legal[\s_-]*name|resume|cover[\s_-]*letter|linked[\s_-]*in/i.test(getDesc(el));
  });
}

let jfBtn = null;
function jfSetBtn(txt, revert) {
  if (!jfBtn) return;
  jfBtn.textContent = txt;
  if (revert) setTimeout(() => { if (jfBtn) jfBtn.textContent = '⚡'; }, 3500);
}

// ---- The one fill routine, used by both the button and auto-fill ----
// manual=true  -> show every outcome (errors, "nothing found")
// manual=false -> only speak up when it actually fills something (no nagging)
async function jfRun(manual) {
  if (jfBtn && manual) { jfBtn.classList.add('filling'); jfBtn.textContent = '⏳'; }
  try {
    const data = await jfGetData();
    if (!data.profile || !data.profile.fullName) {
      if (manual) jfFlash('Your profile is empty. Open localhost:3000 → My Profile → fill and save.', '#f59e0b');
      jfSetBtn('⚡');
      return 0;
    }
    const n = fillForm(data.profile, data.letter || '');
    if (n > 0) {
      jfSetBtn('✅ ' + n, true);
      jfFlash((manual ? 'Filled ' : 'Auto-filled ') + n + ' field' + (n > 1 ? 's' : '') + ' (green). Review before submitting.', '#3ecf8e');
    } else if (manual) {
      jfSetBtn('∅', true);
      jfFlash('No empty fields found here. If the form is in another section/popup, open it and click ⚡ again.', '#f59e0b');
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
    if (jfBtn) jfBtn.classList.remove('filling');
  }
}

try {
  // Inject the button in the top page, or in any sub-frame that truly has fields
  // (skips ad/tracking iframes). Each frame fills its own fields.
  const isTop = window.top === window;
  if (isTop || deepQueryAll('input,textarea,select', document).length > 0) {
    const old = document.getElementById('jf-floating-btn');
    if (old) old.remove();

    jfBtn = document.createElement('button');
    jfBtn.id = 'jf-floating-btn';
    jfBtn.textContent = '⚡';
    jfBtn.title = 'JobFlow Autofill — click to fill this form (auto-fills on load too)';
    document.body.appendChild(jfBtn);
    jfBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); jfRun(true); });
  }

  // ---- AUTO-FILL: on load, and again whenever a new step/modal renders ----
  let autoTimer = null;
  const scheduleAuto = () => {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { if (jfLooksLikeForm()) jfRun(false); }, 1000);
  };
  // Initial pass (wait for SPA frameworks to render their fields)
  setTimeout(scheduleAuto, 1200);
  // Re-run on DOM changes (Workday/Oracle multi-step, LinkedIn Easy Apply modal, etc.),
  // heavily debounced. fillForm only touches empty fields, so re-runs are safe & idempotent.
  const obs = new MutationObserver(scheduleAuto);
  obs.observe(document.documentElement, { childList: true, subtree: true });
} catch (initErr) {
  console.warn('[JobFlow] Init skipped:', initErr.message);
}

// =============================================
// MAIN FILL LOGIC
// =============================================
function fillForm(p, letter) {
  const parts = (p.fullName || '').trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';

  // Parse demographics
  let d = {};
  try {
    if (typeof p.demographics === 'string' && p.demographics.length > 2) {
      d = JSON.parse(p.demographics);
    } else if (typeof p.demographics === 'object' && p.demographics !== null) {
      d = p.demographics;
    }
  } catch (e) { console.warn('[JobFlow] demographics parse error', e); }

  // ---- TEXT INPUT RULES (specific first, general last) ----
  const rules = [
    [/first[\s_-]*name|given[\s_-]*name|\bfname\b/i, first],
    [/last[\s_-]*name|family[\s_-]*name|surname|\blname\b/i, last],
    [/full[\s_-]*name|your[\s_-]*name|candidate[\s_-]*name|legal[\s_-]*name/i, p.fullName],
    [/e[\s_-]*mail/i, p.email],
    [/phone|mobile|cell|contact[\s_-]*number|\btel\b/i, p.phone],
    [/pronoun/i, d.pronouns || ''],
    [/address[\s_-]*line[\s_-]*2|apt|suite|unit\b/i, d.address2 || ''],
    [/address[\s_-]*line[\s_-]*1|street[\s_-]*address/i, d.address1 || ''],
    [/\bcity\b/i, d.city || ''],
    [/\bstate\b|province/i, d.state || ''],
    [/\bzip\b|postal/i, d.zip || ''],
    [/\bcountry\b/i, d.country || ''],
    [/\blocation\b/i, p.location],
    [/linked[\s_-]*in/i, p.linkedin],
    [/\bgithub\b/i, d.github || p.portfolio || ''],
    [/website|portfolio|personal[\s_-]*site/i, d.website || p.portfolio || ''],
    [/current[\s_-]*(company|employer)|\bemployer\b/i, ''],
    [/years?[\s_-]*(of[\s_-]*)?experience/i, p.years],
    [/highest.*education|education[\s_-]*level|degree[\s_-]*level/i, d.edu_level || ''],
    [/university|college|institution|school[\s_-]*name/i, d.university || ''],
    [/major|field[\s_-]*of[\s_-]*study|area[\s_-]*of[\s_-]*study/i, d.major || ''],
    [/\bdegree\b/i, d.degree || ''],
    [/\bgpa\b|grade[\s_-]*point/i, d.gpa || ''],
    [/salary|compensation|desired[\s_-]*pay/i, d.salary || ''],
    [/notice[\s_-]*period|start[\s_-]*date|earliest|when[\s_-]*can[\s_-]*you[\s_-]*start|available[\s_-]*to[\s_-]*start/i, d.notice || ''],
    [/how[\s_-]*did[\s_-]*you[\s_-]*(hear|find|learn)|referral[\s_-]*source|\bsource\b/i, d.source || ''],
    [/\bsummary\b|about[\s_-]*(you|yourself|me)/i, p.summary || ''],
    [/\btitle\b|current[\s_-]*title|job[\s_-]*title/i, p.title || ''],
    // Catch-all "name" last (very generic)
    [/\bname\b/i, p.fullName],
  ];

  // ---- RADIO/CHECKBOX/SELECT DEMOGRAPHIC RULES ----
  const demoRules = [
    [/\bgender\b|\bsex\b/i, d.gender || ''],
    [/race|ethni/i, d.race || ''],
    [/veteran/i, d.veteran || ''],
    [/disabil/i, d.disability || ''],
    [/18[\s_-]*years|over[\s_-]*18|at[\s_-]*least[\s_-]*18|legal[\s_-]*age|older\b/i, d.age18 || ''],
    [/may[\s_-]*we[\s_-]*contact|contact[\s_-]*(your[\s_-]*)?(current|past|previous|former)[\s_-]*(employer|supervisor)/i, d.contact_emp || ''],
    [/sponsor|visa/i, d.sponsorship || ''],
    [/authori[sz]ed[\s_-]*to[\s_-]*work|legally[\s_-]*authori|eligible[\s_-]*to[\s_-]*work|right[\s_-]*to[\s_-]*work|work[\s_-]*(permit|authori)/i, d.authorized || ''],
    [/relocat|willing[\s_-]*to[\s_-]*(move|transfer)/i, d.relocate || ''],
    [/previously[\s_-]*(employed|worked)|employed[\s_-]*(by|at|with)|worked[\s_-]*(here|for[\s_-]*us)|former[\s_-]*employee/i, d.prev_emp || ''],
    [/non[\s_-]*compete|confidentiality|restrictive/i, d.noncompete || ''],
  ];

  let n = 0;

  // 1) TEXT INPUTS & TEXTAREAS (shadow-DOM aware)
  const inputs = deepQueryAll(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]):not([type=image]):not([type=reset]), textarea'
  );

  for (const el of inputs) {
    if (el.disabled || el.readOnly) continue;
    if (el.value && el.value.trim()) continue; // already has a value
    if (el.closest('#jf-floating-btn')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

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
    for (const [re, val] of rules) {
      if (val && re.test(desc)) { setVal(el, val); n++; break; }
    }
  }

  // 2) <SELECT> DROPDOWNS (shadow-DOM aware)
  const selects = deepQueryAll('select');
  for (const sel of selects) {
    if (sel.disabled) continue;
    if (sel.selectedIndex > 0) continue;
    const r = sel.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const desc = getDesc(sel);
    for (const [re, val] of rules) {
      if (val && re.test(desc)) { if (selectByValue(sel, val)) n++; break; }
    }
    if (sel.selectedIndex <= 0) {
      for (const [re, val] of demoRules) {
        if (val && re.test(desc)) { if (selectByValue(sel, val)) n++; break; }
      }
    }
  }

  // 3) RADIO BUTTONS & CHECKBOXES (shadow-DOM aware)
  const radios = deepQueryAll('input[type="radio"], input[type="checkbox"]');
  for (const el of radios) {
    if (el.disabled || el.readOnly || el.checked) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const qText = getQuestionText(el);
    const optText = getOptionText(el);

    for (const [re, val] of demoRules) {
      if (!val) continue;
      if (!re.test(qText)) continue;
      if (matchOption(val, optText)) {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        n++;
        break;
      }
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

function selectByValue(sel, v) {
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
  const parent = el.closest('.field, .form-group, .form-field, [data-automation-id]');
  if (parent) {
    const lbl = parent.querySelector('label, .label, [class*="label"]');
    if (lbl && !desc.includes(lbl.textContent.trim())) desc += ' ' + lbl.textContent;
  }
  return desc;
}

function getQuestionText(el) {
  let text = el.name || '';
  const group = el.closest('fieldset, [role="group"], [role="radiogroup"], .form-group, .application-question, .question-container, [data-automation-id]');
  if (group) {
    const heading = group.querySelector('legend, h1, h2, h3, h4, h5, .question-text, [class*="question"], [class*="label"]');
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
  return text.toLowerCase();
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

function matchOption(savedVal, optionText) {
  const sv = savedVal.toLowerCase().trim();
  const ot = optionText.trim();

  if (sv === 'yes') return /\byes\b|\btrue\b/i.test(ot);
  if (sv === 'no') return /\bno\b|\bfalse\b/i.test(ot) && !/\bnot\b/i.test(ot);

  const svN = sv.replace(/[^a-z0-9]/g, '');
  const otN = ot.replace(/[^a-z0-9]/g, '');
  if (svN === otN) return true;
  if (svN.length > 3 && otN.length > 3) {
    if (otN.includes(svN) || svN.includes(otN)) return true;
  }
  if (/decline|prefernot|dontwish/i.test(svN) && /decline|prefernot|dontwish/i.test(otN)) return true;
  return false;
}
