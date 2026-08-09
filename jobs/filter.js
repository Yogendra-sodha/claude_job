'use strict';
// What counts as a Data Engineer / Data Analyst / Analytics Engineer role.
const ROLE_RE = /data engineer|analytics engineer|data analyst|business intelligence|\bbi\b|data (platform|warehouse|scientist)|data infrastructure|\betl\b|\bdbt\b|\banalytics\b/i;
// Titles that merely contain "analyst" in an unrelated domain — reject unless
// they're clearly data/analytics roles.
const ROLE_NEG = /financial analyst|sales|marketing analyst|credit analyst|risk analyst|research analyst|hr analyst|policy analyst/i;
function matchesRole(title) {
  const t = (title || '').trim();
  if (!t) return false;
  if (ROLE_NEG.test(t) && !/data|analytics engineer/i.test(t)) return false;
  return ROLE_RE.test(t);
}

const US_RE = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b|united states|\bu\.?s\.?a?\.?\b|new york|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles|remote - us|us remote|remote \(us|remote, us/i;
const NON_US_RE = /india|london|\buk\b|united kingdom|ireland|germany|france|spain|poland|emea|apac|europe|canada|toronto|bengaluru|bangalore|singapore|australia|brazil|mexico|latam|remote - (emea|apac|europe|india|canada|uk)/i;
function matchesLocation(loc, remote) {
  const l = (loc || '').trim();
  if (NON_US_RE.test(l)) return false;
  if (remote) return true;              // remote with no non-US marker → treat as US-remote
  if (!l) return false;
  return US_RE.test(l);
}

const NYC_RE = /new york|nyc|\bny\b|jersey|newark|hoboken|new jersey|\bnj\b|brooklyn|manhattan/i;
const EXACT_RE = /^(senior |staff |lead |principal )?(data engineer|analytics engineer)\b/i;
function scoreJob(job) {
  let s = 0;
  const days = job.postedAt ? Math.max(0, (Date.now() - Date.parse(job.postedAt)) / 864e5) : 60;
  s += Math.max(0, 40 - Math.round(days));           // freshness up to +40
  if (NYC_RE.test(job.location || '')) s += 15;       // commutable from Jersey City
  if (job.remote) s += 8;
  if (EXACT_RE.test(job.title || '')) s += 10;        // best-fit titles
  return s;
}
module.exports = { matchesRole, matchesLocation, scoreJob };
