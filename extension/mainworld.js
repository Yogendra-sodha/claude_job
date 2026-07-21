// Runs in the PAGE's own JS context (manifest world: "MAIN"), unlike the rest
// of the extension which runs in the isolated world. This lets us set input
// values through the page's real prototypes so React/Angular/Vue accept them
// as genuine user input — the technique Jobright relies on.
//
// The isolated content script tags a target element with data-jf-token and
// dispatches a synchronous CustomEvent carrying that token (a plain string —
// DOM nodes can't cross the world boundary, tokens can). We re-find the element
// here and set its value in page context.
(function () {
  if (window.__jfMainWorld) return;
  window.__jfMainWorld = true;
  document.documentElement.setAttribute('data-jf-mainworld', '1');

  function setDeep(root, token) {
    let el = root.querySelector('[data-jf-token="' + token + '"]');
    if (el) return el;
    // pierce shadow roots
    const hosts = root.querySelectorAll('*');
    for (const h of hosts) {
      if (h.shadowRoot) { const found = setDeep(h.shadowRoot, token); if (found) return found; }
    }
    return null;
  }

  document.addEventListener('__jf_set', function (ev) {
    try {
      const d = ev.detail || {};
      if (!d.token) return;
      const el = setDeep(document, d.token);
      if (!el) return;
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const last = el.value;
      if (desc && desc.set) desc.set.call(el, d.value); else el.value = d.value;
      if (el._valueTracker) el._valueTracker.setValue(last);   // React
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.removeAttribute('data-jf-token');   // signal to isolated world: handled
    } catch (e) { /* leave the token so the isolated world falls back */ }
  }, true);
})();
