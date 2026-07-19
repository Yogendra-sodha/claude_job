if (!document.getElementById('jf-floating-btn')) {
  const btn = document.createElement('button');
  btn.id = 'jf-floating-btn';
  btn.textContent = '\u26A1';
  btn.title = 'JobFlow Autofill';
  document.body.appendChild(btn);

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add('filling');
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchExtensionData' }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(resp);
          }
        });
      });
      
      if (!response || !response.success) {
        throw new Error(response ? response.error : 'No response from background script');
      }
      
      const data = response.data;
      console.log('[JobFlow] Received data from server:', JSON.stringify(data).substring(0, 500));
      
      if (!data.profile || !data.profile.fullName) {
        alert('JobFlow: Profile is empty or backend is unavailable.\n\n1. Make sure JobFlow is running (start-jobflow.bat)\n2. Fill your profile at http://localhost:3000\n3. Click Save profile');
        return;
      }
      
      const n = fillForm(data.profile, data.letter || '');
      console.log('[JobFlow] Filled', n, 'fields');
      btn.textContent = n > 0 ? '\u2705' : '0';
      setTimeout(() => btn.textContent = '\u26A1', 2500);
    } catch (e) {
      console.error('[JobFlow] Error:', e);
      alert('JobFlow: Could not connect to local server.\n\nMake sure JobFlow is running on localhost:3000.\nError: ' + e.message);
      btn.textContent = '\u274C';
      setTimeout(() => btn.textContent = '\u26A1', 2500);
    } finally {
      btn.classList.remove('filling');
    }
  });
}

function fillForm(p, letter) {
  const parts = (p.fullName || '').trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';

  // Parse demographics - handle both string and object
  let d = {};
  try {
    if (typeof p.demographics === 'string' && p.demographics.length > 2) {
      d = JSON.parse(p.demographics);
    } else if (typeof p.demographics === 'object' && p.demographics !== null) {
      d = p.demographics;
    }
  } catch (e) {
    console.warn('[JobFlow] Failed to parse demographics:', e);
  }
  console.log('[JobFlow] Demographics parsed:', JSON.stringify(d));

  // =============================================
  // TEXT INPUT RULES (order matters — more specific first)
  // =============================================
  const rules = [
    [/first[\s_-]*name|given[\s_-]*name|\bfname\b/i, first],
    [/last[\s_-]*name|family[\s_-]*name|surname|\blname\b/i, last],
    [/full[\s_-]*name|your[\s_-]*name|candidate[\s_-]*name|legal[\s_-]*name|\bname\b/i, p.fullName],
    [/e[\s_-]*mail/i, p.email],
    [/phone|mobile|contact[\s_-]*number|\btel\b/i, p.phone],
    [/pronoun/i, d.pronouns || ''],
    [/address[\s_-]*line[\s_-]*2|apt|suite|unit/i, d.address2 || ''],
    [/address[\s_-]*line[\s_-]*1|street[\s_-]*address\b/i, d.address1 || ''],
    [/\bcity\b/i, d.city || ''],
    [/\bstate\b|province/i, d.state || ''],
    [/\bzip\b|postal/i, d.zip || ''],
    [/\bcountry\b/i, d.country || ''],
    [/\blocation\b|address/i, p.location],
    [/linked[\s_-]*in/i, p.linkedin],
    [/github/i, d.github || p.portfolio || ''],
    [/website|portfolio|personal[\s_-]*site/i, d.website || p.portfolio || ''],
    [/current[\s_-]*(company|employer)|\bemployer\b/i, p.company || ''],
    [/years?[\s_-]*(of[\s_-]*)?experience/i, p.years],
    [/highest.*education|education[\s_-]*level|degree[\s_-]*level/i, d.edu_level || ''],
    [/university|college|institution|school[\s_-]*name/i, d.university || ''],
    [/major|field[\s_-]*of[\s_-]*study|area[\s_-]*of[\s_-]*study/i, d.major || ''],
    [/\bdegree\b/i, d.degree || ''],
    [/\bgpa\b|grade[\s_-]*point/i, d.gpa || ''],
    [/salary|compensation|desired[\s_-]*pay/i, d.salary || ''],
    [/notice[\s_-]*period|start[\s_-]*date|earliest[\s_-]*(start|available)|when[\s_-]*can[\s_-]*you[\s_-]*start|available/i, d.notice || ''],
    [/how[\s_-]*did[\s_-]*you[\s_-]*(hear|find|learn)|referral[\s_-]*source|source/i, d.source || ''],
    [/\bsummary\b|about[\s_-]*(you|yourself|me)/i, p.summary || ''],
    [/\btitle\b|current[\s_-]*title|job[\s_-]*title/i, p.title || ''],
  ];

  // React-compatible setValue
  const setVal = (el, v) => {
    if (!v) return false;
    const tag = el.tagName;
    if (tag === 'SELECT') {
      return setSelectVal(el, v);
    }
    const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value');
    if (nativeSet && nativeSet.set) {
      nativeSet.set.call(el, v);
    } else {
      el.value = v;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.style.outline = '2px solid #3ecf8e';
    return true;
  };

  // Handle <select> dropdowns (Workday, Greenhouse, etc.)
  const setSelectVal = (sel, v) => {
    if (!v) return false;
    const vLow = v.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < sel.options.length; i++) {
      const optText = (sel.options[i].text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const optVal = (sel.options[i].value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (optVal === vLow || optText === vLow) { bestIdx = i; break; }
      if (optText.includes(vLow) || vLow.includes(optText)) {
        const score = Math.min(optText.length, vLow.length);
        if (score > bestScore && score > 2) { bestScore = score; bestIdx = i; }
      }
    }
    if (bestIdx > 0) { // skip index 0 (usually "Select...")
      sel.selectedIndex = bestIdx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.style.outline = '2px solid #3ecf8e';
      return true;
    }
    return false;
  };

  // =============================================
  // FILL TEXT INPUTS & TEXTAREAS
  // =============================================
  const inputs = document.querySelectorAll(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]):not([type=image]):not([type=reset]), textarea'
  );
  let n = 0;
  for (const el of inputs) {
    if (el.value || el.disabled || el.readOnly) continue;
    if (el.closest('#jf-floating-btn')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;

    // Type-specific shortcuts
    if (el.type === 'email' && p.email) { if (setVal(el, p.email)) n++; continue; }
    if (el.type === 'tel' && p.phone) { if (setVal(el, p.phone)) n++; continue; }
    if (el.type === 'url') {
      // Try to match linkedin/github/website
      let urlDesc = getDesc(el);
      if (/linked/i.test(urlDesc) && p.linkedin) { if (setVal(el, p.linkedin)) n++; continue; }
      if (/github/i.test(urlDesc) && (d.github || p.portfolio)) { if (setVal(el, d.github || p.portfolio)) n++; continue; }
      if (p.portfolio) { if (setVal(el, d.website || p.portfolio)) n++; continue; }
    }

    // Textarea cover letter detection
    if (el.tagName === 'TEXTAREA' && letter) {
      let d0 = getDesc(el);
      if (/cover[\s_-]*letter|why[\s_-]*(do[\s_-]*you|are[\s_-]*you|us\b|join)|motivation/i.test(d0)) {
        if (setVal(el, letter)) n++;
        continue;
      }
    }

    // General rule matching
    let desc = getDesc(el);
    for (const [re, val] of rules) {
      if (val && re.test(desc)) { if (setVal(el, val)) { n++; break; } }
    }
  }

  // =============================================
  // FILL <SELECT> DROPDOWNS
  // =============================================
  const selects = document.querySelectorAll('select');
  for (const sel of selects) {
    if (sel.disabled || sel.selectedIndex > 0) continue;
    const r = sel.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    let desc = getDesc(sel);
    for (const [re, val] of rules) {
      if (val && re.test(desc)) { if (setVal(sel, val)) { n++; break; } }
    }
  }

  // =============================================
  // RADIO BUTTONS & CHECKBOXES (demographics + yes/no)
  // =============================================
  const demoRules = [
    [/gender|sex/i, d.gender || ''],
    [/race|ethni/i, d.race || ''],
    [/veteran/i, d.veteran || ''],
    [/disabil/i, d.disability || ''],
    [/18[\s_-]*years|older\b|over[\s_-]*18|at[\s_-]*least[\s_-]*18|legal[\s_-]*age/i, d.age18 || ''],
    [/contact[\s_-]*(current|past|previous)[\s_-]*employ|may[\s_-]*we[\s_-]*contact/i, d.contact_emp || ''],
    [/sponsor|visa[\s_-]*sponsor/i, d.sponsorship || ''],
    [/authori[sz]ed[\s_-]*to[\s_-]*work|legally[\s_-]*authori|eligible[\s_-]*to[\s_-]*work|right[\s_-]*to[\s_-]*work|work[\s_-]*authori/i, d.authorized || ''],
    [/relocat|willing[\s_-]*to[\s_-]*move/i, d.relocate || ''],
    [/previously[\s_-]*employed|employed[\s_-]*(by|at|with)[\s_-]*(this|our|us)|worked[\s_-]*here|former[\s_-]*employee/i, d.prev_emp || ''],
    [/non[\s_-]*compete|confidentiality|restrictive[\s_-]*covenant/i, d.noncompete || ''],
  ];

  const clickOption = (el) => {
    if (el.checked) return false;
    el.click();
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  // Group radio/checkbox by their name or parent container
  const options = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
  for (const el of options) {
    if (el.disabled || el.readOnly || el.checked) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;

    // Build question context text
    let qText = '';
    const fieldset = el.closest('fieldset, [role="group"], [role="radiogroup"], .form-group, .application-question, .question-container, .section, .css-1v1hxbf, [data-automation-id]');
    if (fieldset) {
      // Get just the question heading, not all option text
      const legend = fieldset.querySelector('legend, h1, h2, h3, h4, h5, label:first-of-type, .question-text, [class*="label"], [class*="question"]');
      qText = legend ? legend.textContent : fieldset.textContent.substring(0, 300);
    }
    if (!qText) {
      const parentDiv = el.closest('div, li, tr');
      if (parentDiv) qText = parentDiv.textContent.substring(0, 300);
    }
    qText += ' ' + (el.name || '');

    // Build option text
    let optText = el.value || '';
    if (el.id) {
      try {
        const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
        if (l) optText += ' ' + l.textContent;
      } catch (e) {}
    }
    const wrap = el.closest('label');
    if (wrap) optText += ' ' + wrap.textContent;

    qText = qText.toLowerCase();
    optText = optText.toLowerCase();

    for (const [re, val] of demoRules) {
      if (!val) continue;
      if (!re.test(qText)) continue;

      const normVal = val.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      const normOpt = optText.replace(/[^a-z0-9 ]/g, '').trim();

      let matched = false;

      // Yes/No matching (handle various formats)
      if (normVal === 'yes') {
        matched = /^(yes|y|true|1)$/.test(normOpt.replace(/\s/g, ''));
      } else if (normVal === 'no') {
        matched = /^(no|n|false|0)$/.test(normOpt.replace(/\s/g, ''));
      }

      // Exact match
      if (!matched && normOpt === normVal) {
        matched = true;
      }

      // Fuzzy match — one contains the other
      if (!matched && normOpt.length > 3 && normVal.length > 3) {
        const optWords = normOpt.replace(/\s+/g, '');
        const valWords = normVal.replace(/\s+/g, '');
        if (optWords.includes(valWords) || valWords.includes(optWords)) {
          matched = true;
        }
      }

      // Decline/prefer not match
      if (!matched && /decline|prefer[\s_]*not|don.?t[\s_]*wish/i.test(normVal) && /decline|prefer[\s_]*not|don.?t[\s_]*wish/i.test(normOpt)) {
        matched = true;
      }

      if (matched) {
        if (clickOption(el)) {
          n++;
          console.log('[JobFlow] Checked:', el.name || el.id, '=', optText.trim().substring(0, 50));
        }
        break;
      }
    }
  }

  return n;
}

// Helper: build a description string from an element's attributes and labels
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
      const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (l) desc += ' ' + l.textContent;
    } catch (e) {}
  }
  const wrap = el.closest('label');
  if (wrap) desc += ' ' + wrap.textContent;
  // Also check parent div/li for nearby label text
  const parent = el.closest('.field, .form-group, .form-field, .css-1v1hxbf, [data-automation-id]');
  if (parent) {
    const lbl = parent.querySelector('label, .label, [class*="label"]');
    if (lbl && !desc.includes(lbl.textContent)) desc += ' ' + lbl.textContent;
  }
  return desc;
}
