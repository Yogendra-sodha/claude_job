// JobFlow ATS field capturer — paste into DevTools Console on a job application page.
// Captures form STRUCTURE only (names, ids, labels, options). No typed values,
// no query-string tokens. Downloads a JSON file when done.
(() => {
  const out = [];
  const seen = new Set();
  const txt = (e) => e && e.textContent ? e.textContent.trim().replace(/\s+/g, ' ').slice(0, 200) : '';

  function deep(sel, root, acc) {
    acc = acc || []; root = root || document;
    try {
      root.querySelectorAll(sel).forEach((e) => acc.push(e));
      root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) deep(sel, e.shadowRoot, acc); });
    } catch (_) {}
    return acc;
  }

  const els = deep('input,textarea,select,[role=combobox],[aria-haspopup=listbox],[role=radiogroup],button[aria-expanded]');
  els.forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    const r = el.getBoundingClientRect();
    const rec = {
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      role: el.getAttribute('role'),
      haspopup: el.getAttribute('aria-haspopup'),
      name: el.name || el.getAttribute('name'),
      id: el.id || null,
      placeholder: el.placeholder || null,
      ariaLabel: el.getAttribute('aria-label'),
      autocomplete: el.getAttribute('autocomplete'),
      automationId: el.getAttribute('data-automation-id'),
      testId: el.getAttribute('data-testid'),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
      required: el.required || el.getAttribute('aria-required') === 'true' || null,
      visible: r.width > 0 && r.height > 0,
    };
    if (el.id) { try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) rec.labelFor = txt(l); } catch (_) {} }
    const wrap = el.closest('label'); if (wrap) rec.labelWrap = txt(wrap);
    const grp = el.closest('fieldset,[role=group],[role=radiogroup],.field,.form-group,.application-question,.application-field,[class*=question]');
    if (grp) { const h = grp.querySelector('legend,label,[class*=label],[class*=question]'); rec.containerLabel = txt(h || grp); }
    if (el.getAttribute('aria-labelledby')) {
      rec.labelledby = el.getAttribute('aria-labelledby').split(/\s+/)
        .map((id) => txt(document.getElementById(id))).filter(Boolean).join(' | ');
    }
    if (el.tagName === 'SELECT') rec.options = [...el.options].slice(0, 40).map((o) => o.text.trim());
    out.push(rec);
  });

  const data = {
    url: location.origin + location.pathname, // query string stripped (tokens!)
    title: document.title,
    capturedAt: new Date().toISOString(),
    fieldCount: out.length,
    fields: out,
  };
  const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = location.hostname.replace(/\W+/g, '-') + '-fields.json';
  document.body.appendChild(a); a.click(); a.remove();
  console.log('✅ JobFlow: captured ' + out.length + ' fields — check your Downloads folder');
})();
