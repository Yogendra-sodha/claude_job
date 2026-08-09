// Build-time: prune the candidate list to companies whose ATS board actually
// returns jobs right now. Candidates may be {name,ats,token} or {name,url}
// (URL → auto-detect the ATS). Writes the survivors to seed-companies.json.
const fs = require('fs');
const { FETCHERS } = require('./ats');
const { detectAts } = require('./detect');

(async () => {
  const cand = require('./seed-candidates.json');
  const good = [];
  const seen = new Set();
  for (const c of cand) {
    let ats = c.ats, token = c.token;
    if ((!ats || !token) && c.url) {
      const hit = await detectAts(c.url);
      if (!hit) { console.log('DETECT-FAIL', c.name, c.url); continue; }
      ats = hit.ats; token = hit.token;
    }
    const key = ats + '/' + token;
    if (seen.has(key)) continue; seen.add(key);
    try {
      const n = (await FETCHERS[ats](token)).length;
      if (n > 0) { good.push({ name: c.name, ats, token }); console.log('OK  ', key, n); }
      else console.log('EMPTY', key);
    } catch (e) { console.log('DEAD', key, e.message); }
    await new Promise((r) => setTimeout(r, 120));
  }
  fs.writeFileSync(__dirname + '/seed-companies.json', JSON.stringify(good, null, 1) + '\n');
  console.log('\nkept', good.length, 'of', cand.length);
})();
