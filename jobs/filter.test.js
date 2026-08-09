const F = require('./filter');
let fail = 0; const eq = (g, w, l) => { console.log(g === w ? 'PASS' : 'FAIL', l); if (g !== w) fail++; };
// matchesRole
eq(F.matchesRole('Senior Data Engineer'), true, 'DE');
eq(F.matchesRole('Analytics Engineer'), true, 'AE');
eq(F.matchesRole('Data Analyst, Growth'), true, 'DA');
eq(F.matchesRole('Business Intelligence Developer'), true, 'BI');
eq(F.matchesRole('Software Engineer, Frontend'), false, 'not SWE');
eq(F.matchesRole('Financial Analyst'), false, 'not financial analyst');
eq(F.matchesRole('Sales Development Rep'), false, 'not sales');
// matchesLocation
eq(F.matchesLocation('New York, NY', false), true, 'US city');
eq(F.matchesLocation('', true), true, 'remote');
eq(F.matchesLocation('Remote - US', true), true, 'remote-US');
eq(F.matchesLocation('London, UK', false), false, 'UK out');
eq(F.matchesLocation('Bengaluru, India', false), false, 'India out');
eq(F.matchesLocation('Remote - EMEA', true), false, 'remote EMEA out');
// scoreJob ordering
const now = Date.now();
const nyNew = F.scoreJob({ title: 'Data Engineer', location: 'Jersey City, NJ', remote: false, postedAt: new Date(now).toISOString() });
const remoteOld = F.scoreJob({ title: 'Data Analyst', location: 'Remote - US', remote: true, postedAt: new Date(now - 40 * 864e5).toISOString() });
eq(nyNew > remoteOld, true, 'NYC+new outranks remote+old');
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED'); process.exitCode = fail ? 1 : 0;
