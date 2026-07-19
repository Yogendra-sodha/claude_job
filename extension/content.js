// JobFlow Autofill — Content Script
// Fetches profile data DIRECTLY from localhost (no background script needed)

const JF_API = 'http://127.0.0.1:3000/api/data/extension';

try {
  // Guard: remove old button if extension was reloaded
  const old = document.getElementById('jf-floating-btn');
  if (old) old.remove();

  const btn = document.createElement('button');
  btn.id = 'jf-floating-btn';
  btn.textContent = '\u26A1';
  btn.title = 'JobFlow Autofill — click to fill this form';
  document.body.appendChild(btn);

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add('filling');
    btn.textContent = '\u23F3';

    try {
      const res = await fetch(JF_API);
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const data = await res.json();

      console.log('[JobFlow] Data received, profile:', data.profile?.fullName);

      if (!data.profile || !data.profile.fullName) {
        alert('JobFlow: Profile is empty.\n\n1. Open http://localhost:3000\n2. Go to My Profile tab\n3. Fill your info and click Save');
        btn.textContent = '\u26A1';
        return;
      }

      const n = fillForm(data.profile, data.letter || '');
      console.log('[JobFlow] Filled', n, 'fields');
      btn.textContent = n > 0 ? ('\u2705 ' + n) : '0';
      setTimeout(() => { btn.textContent = '\u26A1'; }, 3000);

    } catch (err) {
      console.error('[JobFlow] Error:', err);
      btn.textContent = '\u274C';
      alert('JobFlow: Cannot reach server.\n\nRun start-jobflow.bat or:\n  cd claude_job && npm start\n\nError: ' + err.message);
      setTimeout(() => { btn.textContent = '\u26A1'; }, 3000);
    } finally {
      btn.classList.remove('filling');
    }
  });
} catch (initErr) {
  // Extension context invalidated — silently ignore (user must refresh page)
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

  console.log('[JobFlow] Demographics keys:', Object.keys(d).filter(k => d[k]).join(', '));

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

  // ---- RADIO/CHECKBOX RULES ----
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

  // =============================================
  // 1) FILL TEXT INPUTS & TEXTAREAS
  // =============================================
  const inputs = document.querySelectorAll(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]):not([type=image]):not([type=reset]), textarea'
  );

  for (const el of inputs) {
    if (el.disabled || el.readOnly) continue;
    if (el.value && el.value.trim()) continue; // already has a value
    if (el.closest('#jf-floating-btn')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Type-based shortcuts
    if (el.type === 'email' && p.email) { setVal(el, p.email); n++; continue; }
    if (el.type === 'tel' && p.phone) { setVal(el, p.phone); n++; continue; }
    if (el.type === 'url') {
      const ud = getDesc(el);
      if (/linked/i.test(ud) && p.linkedin) { setVal(el, p.linkedin); n++; continue; }
      if (/github/i.test(ud) && (d.github || p.portfolio)) { setVal(el, d.github || p.portfolio); n++; continue; }
      if (d.website || p.portfolio) { setVal(el, d.website || p.portfolio); n++; continue; }
    }

    // Cover letter textarea
    if (el.tagName === 'TEXTAREA' && letter) {
      const td = getDesc(el);
      if (/cover[\s_-]*letter|why[\s_-]*(do|are)[\s_-]*you|motivation|interest/i.test(td)) {
        setVal(el, letter); n++; continue;
      }
    }

    // General rule matching
    const desc = getDesc(el);
    for (const [re, val] of rules) {
      if (val && re.test(desc)) {
        setVal(el, val);
        n++;
        console.log('[JobFlow] Filled:', (el.name || el.id || el.placeholder || '?').substring(0, 40), '=', val.substring(0, 30));
        break;
      }
    }
  }

  // =============================================
  // 2) FILL <SELECT> DROPDOWNS
  // =============================================
  const selects = document.querySelectorAll('select');
  for (const sel of selects) {
    if (sel.disabled) continue;
    if (sel.selectedIndex > 0) continue; // already selected something
    const r = sel.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const desc = getDesc(sel);

    // Try text rules
    for (const [re, val] of rules) {
      if (val && re.test(desc)) {
        if (selectByValue(sel, val)) {
          n++;
          console.log('[JobFlow] Selected:', (sel.name || sel.id || '?').substring(0, 40), '=', val.substring(0, 30));
        }
        break;
      }
    }
    // Try demo rules for select dropdowns too
    if (sel.selectedIndex <= 0) {
      for (const [re, val] of demoRules) {
        if (val && re.test(desc)) {
          if (selectByValue(sel, val)) {
            n++;
            console.log('[JobFlow] Selected demo:', (sel.name || sel.id || '?').substring(0, 40), '=', val.substring(0, 30));
          }
          break;
        }
      }
    }
  }

  // =============================================
  // 3) FILL RADIO BUTTONS & CHECKBOXES
  // =============================================
  const radios = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
  for (const el of radios) {
    if (el.disabled || el.readOnly || el.checked) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Get question context
    const qText = getQuestionText(el);
    // Get this option's label text
    const optText = getOptionText(el);

    for (const [re, val] of demoRules) {
      if (!val) continue;
      if (!re.test(qText)) continue;

      if (matchOption(val, optText)) {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        n++;
        console.log('[JobFlow] Checked:', (el.name || el.id || '?').substring(0, 30), '=', optText.substring(0, 40));
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
  const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value');
  if (nativeSet && nativeSet.set) {
    nativeSet.set.call(el, v);
  } else {
    el.value = v;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  // React-specific
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue('');
  el.style.outline = '2px solid #3ecf8e';
}

function selectByValue(sel, v) {
  if (!v) return false;
  const vNorm = v.toLowerCase().replace(/[^a-z0-9]/g, '');
  let bestIdx = -1, bestScore = 0;

  for (let i = 1; i < sel.options.length; i++) {
    const oText = (sel.options[i].text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const oVal = (sel.options[i].value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Exact match
    if (oVal === vNorm || oText === vNorm) { bestIdx = i; break; }
    // Contains match
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

  // Associated label
  if (el.id) {
    try {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) desc += ' ' + lbl.textContent;
    } catch (e) {}
  }
  // Wrapping label
  const wrap = el.closest('label');
  if (wrap) desc += ' ' + wrap.textContent;
  // Parent container label
  const parent = el.closest('.field, .form-group, .form-field, [data-automation-id]');
  if (parent) {
    const lbl = parent.querySelector('label, .label, [class*="label"]');
    if (lbl && !desc.includes(lbl.textContent.trim())) desc += ' ' + lbl.textContent;
  }
  return desc;
}

function getQuestionText(el) {
  let text = el.name || '';
  // Try fieldset/group containers
  const group = el.closest('fieldset, [role="group"], [role="radiogroup"], .form-group, .application-question, .question-container, [data-automation-id]');
  if (group) {
    const heading = group.querySelector('legend, h1, h2, h3, h4, h5, .question-text, [class*="question"], [class*="label"]');
    text += ' ' + (heading ? heading.textContent : group.textContent.substring(0, 400));
  } else {
    // Walk up to find a parent with descriptive text
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

  // Yes/No exact
  if (sv === 'yes') return /\byes\b|\btrue\b/i.test(ot);
  if (sv === 'no') return /\bno\b|\bfalse\b/i.test(ot) && !/\bnot\b/i.test(ot);

  // Normalize for fuzzy
  const svN = sv.replace(/[^a-z0-9]/g, '');
  const otN = ot.replace(/[^a-z0-9]/g, '');

  // Exact normalized
  if (svN === otN) return true;

  // Contains
  if (svN.length > 3 && otN.length > 3) {
    if (otN.includes(svN) || svN.includes(otN)) return true;
  }

  // Decline patterns
  if (/decline|prefernot|dontwish/i.test(svN) && /decline|prefernot|dontwish/i.test(otN)) return true;

  return false;
}
