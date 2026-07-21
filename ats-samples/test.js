// Replays every captured ATS form through the matcher and prints each field's
// assignment, flagging cross-section contamination (the bugs we're fixing).
//   node ats-samples/test.js            → summary + any flags
//   node ats-samples/test.js --verbose  → every field's assignment
const fs = require('fs');
const path = require('path');
const M = require('../extension/matcher.js');

const VERBOSE = process.argv.includes('--verbose');
const dir = __dirname;

// A realistic profile matching the real user data seen in captures.
const P = M.buildProfile({
  fullName: 'Yogendrasinh Sodha',
  email: 'yuvisodha@gmail.com',
  phone: '2012389412',
  location: 'Jersey City',
  linkedin: 'https://www.linkedin.com/in/yogendrasinh-sodha/',
  portfolio: 'https://github.com/Yogendra-sodha',
  title: 'Data Engineer',
  years: '4',
  demographics: JSON.stringify({
    address1: '123 Main St', city: 'Jersey City', state: 'New Jersey', zip: '07307', country: 'United States',
    gender: 'Male', race: 'Asian (Not Hispanic or Latino)', veteran: 'no', disability: 'no',
    authorized: 'yes', sponsorship: 'no', relocate: 'yes', salary: '150000', notice: '2 weeks',
    source: 'LinkedIn',
    educationList: [
      { school: 'NJIT', degree: "Master's", major: 'Data Science', gpa: '3.8', city: 'Newark', state: 'New Jersey', country: 'United States' },
      { school: 'Gujarat University', degree: "Bachelor's", major: 'Computer Engineering', gpa: '3.6', city: 'Ahmedabad', state: 'Gujarat', country: 'India' },
    ],
    workList: [
      { company: 'Aluf Plastics', jobTitle: 'Data Engineer', location: 'Orangeburg, NY', startDate: '03/2024', endDate: '', description: 'Built pipelines' },
      { company: 'Prev Corp', jobTitle: 'Data Analyst', location: 'Remote', startDate: '10/2019', endDate: '10/2021', description: 'Reporting' },
    ],
  }),
});

// Turn a captured field record into the matcher's input shape.
function toField(rec) {
  const specific = rec.labelFor || rec.labelWrap || rec.ariaLabel || rec.placeholder || rec.labelledby || '';
  const container = rec.containerLabel || '';
  const isChoice = rec.type === 'radio' || rec.type === 'checkbox';
  const shortOpt = specific && specific.split(/\s+/).length <= 3;
  return {
    idname: [rec.name, rec.id, rec.automationId, rec.testId].filter(Boolean).join(' '),
    // A short choice label ("Yes") is an option -> question is in the container;
    // a full-sentence choice ("I currently work here") is its own question.
    label: isChoice ? (shortOpt ? (container || specific) : specific) : (specific || container),
    section: container,
    optionText: isChoice ? specific : '',
    type: rec.type,
    tag: rec.tag,
    role: rec.role,
    options: rec.options,
  };
}

// Contamination rules: (fieldLooksLike) that must NOT receive (value)
function contamination(rec, section, key, value) {
  if (!value) return null;
  const lab = (rec.labelFor || rec.labelWrap || rec.containerLabel || '').toLowerCase();
  const idn = ((rec.name || '') + ' ' + (rec.id || '')).toLowerCase();
  const nameVals = [P.fullName.toLowerCase(), P.firstName.toLowerCase(), P.lastName.toLowerCase()];
  const isNameVal = nameVals.includes(value.toLowerCase());
  if (isNameVal && /company|employer|\borg\b/.test(lab + ' ' + idn)) return 'NAME→company';
  if (isNameVal && /school|universit|college/.test(lab + ' ' + idn)) return 'NAME→school';
  if (isNameVal && /\breferr/.test(lab + ' ' + idn)) return 'NAME→referrer';
  if (value.toLowerCase() === P.homeCity.toLowerCase() && /education|school/.test((rec.containerLabel || '').toLowerCase() + ' ' + idn)) return 'HOMECITY→education';
  return null;
}

let totalFilled = 0, totalFields = 0, flags = [];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const fields = (data.fields || []).filter((f) => f.visible && !['button', 'a'].includes(f.tag) && !['submit', 'hidden', 'password', 'file'].includes(f.type));
  const filledOnce = new Set();
  const entryCount = {};
  let filled = 0;
  const lines = [];
  for (const rec of fields) {
    const f = toField(rec);
    const { section, key } = M.classify(f);
    // education/work keys resolve from the i-th resume entry (mirrors content.js valueFor)
    let value;
    if (M.isEntryKey(key)) {
      const i = entryCount[key] || 0; entryCount[key] = i + 1;
      value = M.resolveEntry(key, M.entryListFor(key, P)[i]);
    } else {
      value = M.resolveValue(key, P);
    }
    // simulate single-fill-per-key (e.g. website)
    if (value && M.SINGLE_FILL.has(key)) {
      if (filledOnce.has(key)) { value = ''; }
      else filledOnce.add(key);
    }
    // native selects: resolve to a real option
    if (value && rec.options && rec.options.length) {
      const idx = M.pickOption(rec.options, value, M.kindFor(key));
      value = idx >= 0 ? '[opt] ' + rec.options[idx] : '';
    }
    // radios/checkboxes: this element is only "filled" if its option matches
    if (value && (rec.type === 'radio' || rec.type === 'checkbox')) {
      value = M.matchOption(value, f.optionText, M.kindFor(key)) ? '[check] ' + f.optionText : '';
    }
    if (value) filled++;
    const flag = contamination(rec, section, key, value);
    if (flag) flags.push(`${file}: ${flag} — "${(rec.labelFor || rec.labelWrap || rec.containerLabel || rec.name || '').slice(0, 45)}" got "${value}"`);
    lines.push(
      (value ? '  ✓ ' : '    ').padEnd(4) +
      (section + '/' + (key || '-')).padEnd(24) +
      (value || '·').slice(0, 30).padEnd(31) +
      '"' + (rec.labelFor || rec.labelWrap || rec.containerLabel || rec.name || '').slice(0, 40) + '"'
    );
  }
  totalFilled += filled; totalFields += fields.length;
  console.log(`\n=== ${file}  (${filled}/${fields.length} filled) ===`);
  if (VERBOSE) console.log(lines.join('\n'));
}

console.log(`\n──────────────────────────────────────────`);
console.log(`TOTAL: ${totalFilled}/${totalFields} fillable fields assigned a value`);
if (flags.length) {
  console.log(`\n❌ ${flags.length} CONTAMINATION FLAG(S):`);
  flags.forEach((f) => console.log('   ' + f));
  process.exit(1);
} else {
  console.log(`✅ No cross-section contamination (no name→company/school/referrer, no home-city→education)`);
}
