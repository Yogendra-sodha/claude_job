const $ = id => document.getElementById(id);

chrome.storage.local.get(['profile', 'letter']).then(d => {
  if (d.profile) {
    $('json').value = JSON.stringify(d.profile, null, 2);
    $('status').textContent = 'Profile loaded: ' + (d.profile.fullName || '(no name set)');
  } else {
    $('status').textContent = 'First time? Open the profile section below and paste your JobFlow profile.';
    $('profBox').open = true;
  }
  if (d.letter) $('letter').value = d.letter;
});

$('saveLetter').onclick = async () => {
  await chrome.storage.local.set({ letter: $('letter').value.trim() });
  $('status').textContent = '✅ Cover letter saved — Fill will paste it into cover-letter boxes.';
};

$('save').onclick = async () => {
  try {
    const p = JSON.parse($('json').value);
    await chrome.storage.local.set({ profile: p });
    $('status').textContent = '✅ Saved: ' + (p.fullName || 'profile');
  } catch (e) {
    $('status').textContent = '⚠️ Invalid JSON: ' + e.message;
  }
};

$('fill').onclick = async () => {
  const d = await chrome.storage.local.get(['profile', 'letter']);
  if (!d.profile) { $('status').textContent = '⚠️ Save your profile first (section below).'; $('profBox').open = true; return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: fillForm, args: [d.profile, d.letter || ''] });
  } catch (e) {
    try {
      results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillForm, args: [d.profile, d.letter || ''] });
    } catch (e2) {
      $('status').textContent = '⚠️ Cannot run on this page: ' + e2.message;
      return;
    }
  }
  const n = results.reduce((s, r) => s + (r.result || 0), 0);
  $('status').textContent = n
    ? '✅ Filled ' + n + ' field' + (n > 1 ? 's' : '') + ' (highlighted green). Review before submitting!'
    : 'No matching empty fields found — this form may use unusual field names, or fields are already filled.';
};

// Injected into the page. Must be fully self-contained.
function fillForm(p, letter) {
  const parts = (p.fullName || '').trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';
  // Order = priority: specific fields first, generic "name" catch-all near the end.
  const rules = [
    [/first[\s_-]*name|given[\s_-]*name|\bfname\b/i, first],
    [/last[\s_-]*name|family[\s_-]*name|surname|\blname\b/i, last],
    [/e[\s_-]*mail/i, p.email],
    [/phone|mobile|contact[\s_-]*number|\btel\b/i, p.phone],
    [/linked[\s_-]*in/i, p.linkedin],
    [/github|portfolio|personal[\s_-]*(web)?site|\bwebsite\b/i, p.portfolio],
    [/current[\s_-]*(company|employer)|\bemployer\b/i, p.company || ''],
    [/\bcity\b|location|address/i, p.location],
    [/years?[\s_-]*(of[\s_-]*)?experience/i, p.years],
    [/full[\s_-]*name|your[\s_-]*name|candidate[\s_-]*name|legal[\s_-]*name|\bname\b/i, p.fullName],
    [/\bsummary\b|about[\s_-]*(you|yourself|me)/i, p.summary || '']
  ];
  const setVal = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v); // works with React/Vue-controlled inputs
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.style.outline = '2px solid #3ecf8e';
  };
  const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]), textarea');
  let n = 0;
  for (const el of inputs) {
    if (el.value || el.disabled || el.readOnly) continue; // never overwrite
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue; // skip invisible fields
    if (el.type === 'email' && p.email) { setVal(el, p.email); n++; continue; }
    if (el.type === 'tel' && p.phone) { setVal(el, p.phone); n++; continue; }
    if (el.tagName === 'TEXTAREA' && letter) {
      let d0 = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-automation-id')].filter(Boolean).join(' ');
      const w0 = el.closest('label'); if (w0) d0 += ' ' + w0.textContent;
      if (/cover[\s_-]*letter|why[\s_-]*(do[\s_-]*you|are[\s_-]*you|us\b|join)|motivation/i.test(d0)) { setVal(el, letter); n++; continue; }
    }
    let desc = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.getAttribute('data-automation-id')].filter(Boolean).join(' ');
    if (el.id) {
      try {
        const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
        if (l) desc += ' ' + l.textContent;
      } catch (e) {}
    }
    const wrap = el.closest('label');
    if (wrap) desc += ' ' + wrap.textContent;
    for (const [re, val] of rules) {
      if (val && re.test(desc)) { setVal(el, val); n++; break; }
    }
  }
  return n;
}
