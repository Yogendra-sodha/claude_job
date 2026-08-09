'use strict';
// Fetch + normalize public ATS job boards into one shape:
//   {extId, title, location, remote, url, department, postedAt, description}
const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
const iso = (d) => { if (!d && d !== 0) return null; const t = typeof d === 'number' ? d : Date.parse(d); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

function normalizeGreenhouse(json) {
  return (json.jobs || []).map((j) => ({
    extId: String(j.id),
    title: j.title || '',
    location: (j.location && j.location.name) || '',
    remote: /remote/i.test((j.location && j.location.name) || ''),
    url: j.absolute_url,
    department: (j.departments && j.departments[0] && j.departments[0].name) || '',
    postedAt: iso(j.updated_at || j.first_published),
    description: stripHtml(j.content),
  })).filter((j) => j.extId && j.title && j.url);
}
function normalizeLever(json) {
  return (Array.isArray(json) ? json : []).map((j) => ({
    extId: String(j.id),
    title: j.text || '',
    location: (j.categories && j.categories.location) || '',
    remote: (j.workplaceType || '').toLowerCase() === 'remote' || /remote/i.test((j.categories && j.categories.location) || ''),
    url: j.hostedUrl || j.applyUrl,
    department: (j.categories && (j.categories.team || j.categories.department)) || '',
    postedAt: iso(j.createdAt),
    description: stripHtml(j.descriptionPlain || j.description),
  })).filter((j) => j.extId && j.title && j.url);
}
function normalizeAshby(json) {
  return (json.jobs || []).map((j) => ({
    extId: String(j.id),
    title: j.title || '',
    location: j.location || (j.address && j.address.postalAddress && j.address.postalAddress.addressLocality) || '',
    remote: !!j.isRemote,
    url: j.jobUrl || j.applyUrl,
    department: j.department || j.team || '',
    postedAt: iso(j.publishedAt),
    description: stripHtml(j.descriptionPlain || j.descriptionHtml),
  })).filter((j) => j.extId && j.title && j.url);
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'JobFlow/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const fetchGreenhouse = async (t) => normalizeGreenhouse(await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs?content=true`));
const fetchLever = async (t) => normalizeLever(await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`));
const fetchAshby = async (t) => normalizeAshby(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}`));
const FETCHERS = { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby };

module.exports = { normalizeGreenhouse, normalizeLever, normalizeAshby, fetchGreenhouse, fetchLever, fetchAshby, FETCHERS };
