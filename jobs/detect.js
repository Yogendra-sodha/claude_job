'use strict';
// Detect which ATS (and board token) a company uses, from its careers page HTML
// or a careers URL. Returns {ats, token} or null (null → likely Workday/Oracle,
// which is Phase 2).
const PATTERNS = [
  ['greenhouse', /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\/js\?for=|embed\/job_board\?for=)?([a-z0-9-]+)/i],
  ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9-]+)/i],
  ['lever', /jobs\.lever\.co\/([a-z0-9-]+)/i],
  ['lever', /api\.lever\.co\/v0\/postings\/([a-z0-9-]+)/i],
  ['ashby', /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i],
  ['ashby', /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9-]+)/i],
];
const BAD = /^(js|embed|v1|v0|api|www|for|job_board)$/i;

function detectFromHtml(html) {
  const h = html || '';
  for (const [ats, re] of PATTERNS) {
    const m = h.match(re);
    if (m && m[1] && !BAD.test(m[1])) return { ats, token: m[1] };
  }
  return null;
}

async function fetchText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 JobFlow' } });
  return { html: await r.text(), finalUrl: r.url };
}

async function detectAts(url) {
  try {
    const u = /^https?:/i.test(url) ? url : 'https://' + url;
    // Fast path: the pasted URL may itself be the ATS board link.
    const direct = detectFromHtml(u);
    if (direct) return direct;
    const { html, finalUrl } = await fetchText(u);
    let hit = detectFromHtml(html) || detectFromHtml(finalUrl);
    if (!hit) {
      // Many sites keep the board behind /careers or /jobs — try one hop.
      for (const path of ['/careers', '/jobs']) {
        try {
          const { html: h2 } = await fetchText(new URL(path, u).href);
          hit = detectFromHtml(h2);
          if (hit) break;
        } catch (e) { /* ignore */ }
      }
    }
    return hit;
  } catch (e) { return null; }
}

module.exports = { detectFromHtml, detectAts };
