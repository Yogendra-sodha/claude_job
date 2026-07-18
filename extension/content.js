if (!document.getElementById('jf-floating-btn')) {
  const btn = document.createElement('button');
  btn.id = 'jf-floating-btn';
  btn.innerHTML = '⚡';
  btn.title = 'JobFlow Autofill';
  document.body.appendChild(btn);

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add('filling');
    try {
      const res = await fetch('http://127.0.0.1:3000/api/data/extension');
      if (!res.ok) throw new Error('JobFlow server not running');
      const data = await res.json();
      
      if (!data.profile || !data.profile.fullName) {
        alert('JobFlow: Profile is empty or backend is unavailable. Have you filled your profile in the app?');
        return;
      }
      
      const n = fillForm(data.profile, data.letter || '');
      if (n > 0) {
        btn.innerHTML = '✅';
        setTimeout(() => btn.innerHTML = '⚡', 2000);
      } else {
        btn.innerHTML = '🤷';
        setTimeout(() => btn.innerHTML = '⚡', 2000);
      }
    } catch (e) {
      console.error(e);
      alert('JobFlow: Could not connect to local server. Make sure JobFlow is running on localhost:3000.');
      btn.innerHTML = '❌';
      setTimeout(() => btn.innerHTML = '⚡', 2000);
    } finally {
      btn.classList.remove('filling');
    }
  });
}

function fillForm(p, letter) {
  const parts = (p.fullName || '').trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';
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
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.style.outline = '2px solid #3ecf8e';
  };
  const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=password]), textarea');
  let n = 0;
  for (const el of inputs) {
    if (el.value || el.disabled || el.readOnly) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
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
