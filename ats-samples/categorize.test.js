// Unit tests for the pure decision logic behind the review-and-select AI fill:
// named compliance rules, isYesNoOptions, categorizeQuestion, complianceDefault.
// Run: node ats-samples/categorize.test.js
const A = require('../extension/matcher');

let failed = 0;
function eq(got, want, label) {
  const ok = got === want;
  console.log((ok ? 'PASS' : 'FAIL'), label, '->', JSON.stringify(got));
  if (!ok) failed++;
}
const key = (label, extra) => A.classify(Object.assign({ idname: '', label, section: '', tag: 'select', role: null }, extra)).key;

// --- named compliance rules (leverage existing noncompete/prev_emp/contact_emp fields) ---
eq(key('Are you subject to a non-compete or restrictive covenant?'), 'noncompete', 'noncompete');
eq(key('Have you previously been employed by us?'), 'prev_emp', 'prev_emp');
eq(key('Do you have any relatives currently employed here?'), 'contact_emp', 'contact_emp (relatives)');

// these must NOT be swallowed by the new rules
eq(key('Are you authorized to work in the U.S.?'), 'authorized', 'authorized still works');
eq(key('Will you require visa sponsorship?'), 'sponsorship', 'sponsorship still works');

// --- isYesNoOptions ---
eq(A.isYesNoOptions(['Select...', 'Yes', 'No']), true, 'yesno options');
eq(A.isYesNoOptions(['Yes', 'No', 'Decline to answer']), true, 'yesno+decline options');
eq(A.isYesNoOptions(['United States', 'India', 'Canada']), false, 'not yesno (countries)');
eq(A.isYesNoOptions(['Male', 'Female', 'Non-Binary', 'Decline']), false, 'not yesno (4 options)');

// --- categorizeQuestion ---
eq(A.categorizeQuestion({ tag: 'textarea', label: 'Tell us about a project' }, []), 'essay', 'textarea -> essay');
eq(A.categorizeQuestion({ tag: 'input', type: 'text', label: 'Why are you interested in joining Tailscale?' }, []), 'essay', 'why -> essay');
eq(A.categorizeQuestion({ tag: 'select', label: 'Have you used us before?' }, ['Yes', 'No']), 'compliance', 'yesno -> compliance');
eq(A.categorizeQuestion({ tag: 'select', label: 'Country of citizenship' }, ['US', 'India', 'Canada', 'UK']), 'multi', 'multi dropdown');
eq(A.categorizeQuestion({ tag: 'div', role: 'combobox', label: 'How did you hear about us?' }, ['LinkedIn', 'Indeed', 'Referral']), 'multi', 'combobox multi');
eq(A.categorizeQuestion({ tag: 'input', type: 'text', label: 'Preferred pronoun set' }, []), 'short', 'short text');

// --- complianceDefault via buildProfile ---
eq(A.buildProfile({ fullName: 'X', demographics: JSON.stringify({}) }).complianceDefault, 'No', 'default -> No');
eq(A.buildProfile({ fullName: 'X', demographics: JSON.stringify({ complianceDefault: 'Yes' }) }).complianceDefault, 'Yes', 'stored -> Yes');

console.log(failed ? ('\n' + failed + ' FAILED') : '\nALL PASSED');
process.exitCode = failed ? 1 : 0;
