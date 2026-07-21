// JobFlow field matcher — pure, section-aware classification.
// Shared by the extension (content.js) and the test harness (ats-samples/test.js),
// so behavior is verified against real captured forms, not guesses.
//
// Two stages:
//   classify(field)      -> { section, key }   (what IS this field?)
//   resolveValue(key, P) -> string             (what value belongs there, or '')
//
// The golden rule: a field only gets a value when we hold the RIGHT value for
// that field's section. We would rather leave a box empty than put the home
// city into an Education block or the candidate's name into "Company Name".

(function (root) {
  'use strict';

  const lc = (s) => (s || '').toString().toLowerCase();
  // Split camelCase / dotted / underscored identifiers so word patterns hit,
  // e.g. "CandProfileFields.EducationCity" -> "cand profile fields education city".
  // Split BEFORE lowercasing, or the camelCase boundary is lost.
  const words = (s) =>
    (s || '').toString()
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[._\-\[\]]+/g, ' ')
      .replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- SECTION
  // Decide which part of an application a field belongs to. Identifier + the
  // section heading matter more than the visible label (labels like "City"
  // repeat across sections; ids like "EducationCity" do not).
  function detectSection(f) {
    // `self` = the field's OWN identity (id + specific label). Trustworthy.
    // `cont` = the surrounding container heading. Often polluted in captures,
    //          so it is only a fallback for education/work (repeated blocks
    //          where a field's own label is generic like "City" or "Year").
    const self = words(f.idname) + ' ' + words(f.label);
    const cont = words(f.section);
    const notChoice = f.type !== 'radio' && f.type !== 'checkbox' && f.tag !== 'select';

    if (/\breferr/.test(self) && /(name|specify|who|whom|please)/.test(self) && notChoice) return 'referral';
    if (/gender|\bsex\b|\brace\b|ethnic|hispanic|latino|veteran|disab|self ?identif|\beeo\b|demographic/.test(self)) return 'eeo';
    if (/education|\bschool\b|universit|college|institution|\bdegree\b|field of study|discipline|\bmajor\b|\bgpa\b|grade (average|point)|overall result|graduat|academic|candprofile|alma mater/.test(self)) return 'education';
    if (/work ?history|work experience|employment|\bemployer\b|companyname|\bcompany\b|\borg\b|current company|job title|role description|professional experience|currently work|most recent (company|title|employer|position)/.test(self)) return 'work';
    if (/linked ?in|git ?hub|portfolio|twitter|personal (web)?site|\bwebsite\b|\burl\b/.test(self)) return 'links';

    // container fallback — education/work only
    if (/education|\bschool\b|universit|college|academic/.test(cont)) return 'education';
    if (/work ?history|work experience|employment|current company|professional experience/.test(cont)) return 'work';

    return 'personal';
  }

  // ------------------------------------------------------------------- KEY
  // Fields that ask for SOMEONE ELSE'S name — never the candidate's.
  const OTHERS_NAME = /their name|relative|\breference|emergency|spouse|next of kin|parent|guardian|supervisor|manager.?s? name|contact.?s? name|colleague|referr/;

  function detectKey(section, f) {
    const id = words(f.idname);
    // KEY detection must NOT use the container/section text: captured containers
    // are often polluted with a sibling field's label (e.g. a "Last Name" input
    // whose container reads "First Name"). Identifier + specific label only.
    const lab = words(f.label);
    const hay = id + ' ' + lab;
    const isChoice = f.tag === 'select' || f.type === 'radio' || f.type === 'checkbox';

    if (section === 'referral') return 'referrerName';

    // Consent / privacy / acknowledgement checkboxes (borrowed from Jobright's
    // keyword approach) — required on most applications to submit.
    if (isChoice && /\bagree\b|\baccept\b|acknowledge|\bconsent\b|privacy (policy|notice|statement)|\bterms\b|certify that|read and understand|processing of my|i authorize (the|you|us|this)/.test(hay)) {
      return 'consent';
    }

    // Demographic ANSWERS only ever live in a dropdown/radio/checkbox. A text
    // input inside an EEO form is a name/date/ID field → fall through to personal.
    if (section === 'eeo' && isChoice) {
      if (/hispanic|latino/.test(hay)) return 'hispanic';
      if (/gender|\bsex\b/.test(hay)) return 'gender';
      if (/race|ethnic/.test(hay)) return 'race';
      if (/veteran/.test(hay)) return 'veteran';
      if (/disab/.test(hay)) return 'disability';
      return null;
    }

    if (section === 'links') {
      if (/linked ?in/.test(hay)) return 'linkedin';
      if (/git ?hub/.test(hay)) return 'github';
      if (/twitter/.test(hay)) return null;              // no data
      if (/portfolio|personal (web)?site|\bwebsite\b|\burl\b/.test(hay)) return 'website';
      return null;
    }

    if (section === 'education') {
      if (/school|universit|college|institution|alma/.test(hay) && !/city|state|country|zip/.test(hay)) return 'eduSchool';
      if (/\bdegree\b|education level|highest|qualification/.test(hay)) return 'eduDegree';
      if (/major|field of study|discipline|area of study/.test(hay)) return 'eduMajor';
      if (/\bgpa\b|grade (average|point)|overall result/.test(hay)) return 'eduGpa';
      if (/\bcity\b|\btown\b/.test(hay)) return 'eduCity';     // resolves to '' (no data)
      if (/\bstate\b|province/.test(hay)) return 'eduState';   // ''
      if (/\bcountry\b/.test(hay)) return 'eduCountry';        // ''
      return null;                                            // dates/years -> skip
    }

    if (section === 'work') {
      if (/job title|position title|\btitle\b|role/.test(hay) && !/role description/.test(hay)) return 'workTitle';
      if (/compan|employer|organi/.test(hay)) return 'workCompany';   // '' — never the person's name
      if (/\blocation\b|\bcity\b/.test(hay)) return 'workLocation';    // ''
      return null;
    }

    // ---- personal + generic custom questions ----
    const selfName = !OTHERS_NAME.test(hay);   // is this the candidate's own name?
    if (/first ?name|given ?name|\bfname\b/.test(hay) && selfName) return 'firstName';
    if (/last ?name|family ?name|surname|\blname\b/.test(hay) && selfName) return 'lastName';
    if (/middle/.test(hay)) return null;                       // no data
    if (/preferred ?name/.test(hay) && selfName) return 'firstName';
    if (/e ?mail/.test(hay)) return 'email';
    if (/full ?name|legal ?name|candidate ?name|your ?name|^name$|\bname\b/.test(hay) && selfName) return 'fullName';
    if (/country phone code|phone country/.test(hay)) return null;
    if (/extension/.test(hay)) return null;
    if (/phone|mobile|\bcell\b|\btel\b|contact number/.test(hay)) return 'phone';
    if (/pronoun/.test(hay)) return 'pronouns';

    // address (home) — specific sub-fields BEFORE the generic "address"/"street"
    // catch-all, because ATSs prefix them all (AddressCity, AddressZip, …).
    // Gate on a structured field (short label or an address-ish id) so a long
    // question like "please state their names" doesn't match on the verb "state".
    const labWords = lab ? lab.split(' ').length : 0;
    const addrLike = labWords <= 5 || /address|city|state|province|zip|postal|country|county|location|street|town/.test(id);
    if (addrLike) {
      if (/address ?(line ?)?2|\bapt\b|\bsuite\b|\bunit\b/.test(hay)) return 'homeStreet2';
      if (/\bcounty\b/.test(hay)) return null;                 // not "country"
      if (/\bcity\b|\btown\b/.test(hay)) return 'homeCity';
      if (/\bstate\b|province/.test(hay)) return 'homeState';
      if (/\bzip\b|postal/.test(hay)) return 'homeZip';
      if (/\bcountry\b/.test(hay)) return 'homeCountry';
      if (/address ?(line ?)?1|\bstreet\b|^address$|\baddress\b/.test(hay)) return 'homeStreet1';
      if (/\blocation\b/.test(hay)) return 'location';
    }

    // generic custom questions
    if (/salary|compensation|desired pay|expected pay/.test(hay)) return 'salary';
    if (/notice period|start date|earliest|when can you start|availability|available to start|looking to start|start a (new )?position/.test(hay)) return 'notice';
    if (/how did you (hear|find|learn)|referral source|hear about|\bsource\b/.test(hay)) return 'source';
    if (/authori[sz]ed to work|legally authori|eligible to work|right to work|work (permit|authori)/.test(hay)) return 'authorized';
    if (/sponsor|visa/.test(hay)) return 'sponsorship';
    if (/relocat|willing to (move|relocate|transfer)/.test(hay)) return 'relocate';
    if (/18 ?years|over ?18|at least ?18|legal age|older\b/.test(hay)) return 'age18';
    if (/years? (of )?experience/.test(hay)) return 'years';
    if (/summary|about (you|yourself|me)/.test(hay)) return 'summary';
    if (/cover ?letter|why (do|are) you|motivation/.test(hay)) return 'coverLetter';
    if (/current (job )?title|job title|your title|\btitle\b/.test(hay)) return 'title';
    return null;
  }

  function classify(f) {
    const section = detectSection(f);
    const key = detectKey(section, f);
    return { section, key };
  }

  // --------------------------------------------------------------- RESOLVE
  // Which keys are "one entry only" — filling the same value into every
  // repeated block (Bachelor's AND Master's) is the exact bug we're killing.
  // Education/work keys are now filled per-entry (the i-th block from the i-th
  // resume entry), so they are NOT single-fill. Only 'website' stays single.
  const SINGLE_FILL = new Set(['website']);

  // Which keys are resolved from an education / work ENTRY (array element).
  const EDU_KEYS = { eduSchool: 'school', eduDegree: 'degree', eduMajor: 'major', eduGpa: 'gpa', eduCity: 'city', eduState: 'state', eduCountry: 'country' };
  const WORK_KEYS = { workCompany: 'company', workTitle: 'jobTitle', workLocation: 'location' };

  // Resolve an education/work key from a specific entry object. Returns '' when
  // there is no such entry (e.g. a 3rd education block but only 2 entries).
  function resolveEntry(key, entry) {
    if (!entry) return '';
    if (EDU_KEYS[key]) return String(entry[EDU_KEYS[key]] || '');
    if (WORK_KEYS[key]) {
      if (key === 'workTitle') return String(entry.jobTitle || entry.title || '');
      return String(entry[WORK_KEYS[key]] || '');
    }
    return '';
  }
  const isEntryKey = (key) => !!(EDU_KEYS[key] || WORK_KEYS[key]);
  const entryListFor = (key, P) => (EDU_KEYS[key] ? P.educationList : P.workList) || [];

  // Kind hint for option/radio matching
  const YESNO_KEYS = { authorized: 1, sponsorship: 1, relocate: 1, age18: 1, hispanic: 1, contact_emp: 1, prev_emp: 1, noncompete: 1 };
  function kindFor(key) {
    if (key === 'veteran') return 'veteran';
    if (key === 'disability') return 'disability';
    if (YESNO_KEYS[key]) return 'yesno';
    if (key === 'gender' || key === 'race') return key;
    return null;
  }

  // P is the normalized profile (built by buildProfile). Returns '' when we do
  // not hold a correct value for that key — caller then leaves the field alone.
  function resolveValue(key, P) {
    if (!key) return '';
    switch (key) {
      // never claim these — no correct value exists for them
      case 'referrerName':
      case 'workCompany':
      case 'workLocation':
      case 'eduCity':
      case 'eduState':
      case 'eduCountry':
        return '';
      case 'consent':
        return 'yes';   // checking an acknowledgement box
      default:
        return P[key] != null ? String(P[key]) : '';
    }
  }

  // Build the normalized profile from the extension API payload (profile + demographics).
  function buildProfile(profile) {
    const d = (() => {
      try {
        if (typeof profile.demographics === 'string' && profile.demographics.length > 2) return JSON.parse(profile.demographics);
        if (profile.demographics && typeof profile.demographics === 'object') return profile.demographics;
      } catch (e) {}
      return {};
    })();
    const full = (profile.fullName || '').trim();
    const parts = full.split(/\s+/);
    let hispanic = d.hispanic || '';
    if (!hispanic && d.race) hispanic = /not hispanic/i.test(d.race) ? 'no' : (/hispanic|latino/i.test(d.race) ? 'yes' : '');

    // Multi-entry resume data lives in the demographics blob. Fall back to a
    // single synthesized entry from the old flat fields for backward compat.
    let educationList = Array.isArray(d.educationList) ? d.educationList.filter((e) => e && (e.school || e.degree || e.major)) : [];
    let workList = Array.isArray(d.workList) ? d.workList.filter((e) => e && (e.company || e.jobTitle || e.title)) : [];
    if (!educationList.length && (d.university || d.degree || d.major || d.gpa)) {
      educationList = [{ school: d.university || '', degree: d.degree || '', major: d.major || '', gpa: d.gpa || '', city: '', state: '', country: '' }];
    }
    if (!workList.length && profile.title) {
      workList = [{ company: '', jobTitle: profile.title || '', location: '', startDate: '', endDate: '', description: '' }];
    }

    return {
      educationList: educationList,
      workList: workList,
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      fullName: full,
      email: profile.email || '',
      phone: profile.phone || '',
      pronouns: d.pronouns || '',
      homeStreet1: d.address1 || '',
      homeStreet2: d.address2 || '',
      homeCity: d.city || '',
      homeState: d.state || '',
      homeZip: d.zip || '',
      homeCountry: d.country || '',
      location: profile.location || '',
      linkedin: profile.linkedin || '',
      github: d.github || profile.portfolio || '',
      website: d.website || profile.portfolio || '',
      eduSchool: d.university || '',
      eduDegree: d.degree || '',
      eduMajor: d.major || '',
      eduGpa: d.gpa || '',
      eduLevel: d.edu_level || '',
      workTitle: profile.title || '',
      title: profile.title || '',
      years: profile.years || '',
      summary: profile.summary || '',
      coverLetter: '',
      salary: d.salary || '',
      notice: d.notice || '',
      source: d.source || '',
      gender: d.gender || '',
      race: d.race || '',
      veteran: d.veteran || '',
      disability: d.disability || '',
      hispanic: hispanic,
      authorized: d.authorized || '',
      sponsorship: d.sponsorship || '',
      relocate: d.relocate || '',
      age18: d.age18 || '',
      contact_emp: d.contact_emp || '',
      prev_emp: d.prev_emp || '',
      noncompete: d.noncompete || '',
    };
  }

  // --------------------------------------------------- OPTION / RADIO MATCH
  function matchOption(savedVal, optionText, kind) {
    const sv = lc(savedVal).trim();
    const ot = (optionText || '').trim();
    if (!sv || !ot) return false;

    const declineRe = /decline|prefer ?not|don.?t ?wish|do ?not ?wish|no ?answer/i;
    const svDecline = declineRe.test(sv);
    if (svDecline) return declineRe.test(ot);
    if (declineRe.test(ot)) return false;

    const svNo = /^no\b|^not\b|not ?a |don.?t|do ?not/.test(sv) && !svDecline;
    const svYes = (/^yes\b|^i ?(am|do|have|identify)\b/.test(sv) || sv === 'yes') && !/not/.test(sv);

    if (kind === 'veteran') {
      if (svNo) return /not ?a ?(protected ?)?veteran|i ?am ?not/i.test(ot);
      if (svYes) return /(identify ?as|one ?or ?more|is ?a ?protected)/i.test(ot) && !/not/i.test(ot);
    }
    if (kind === 'disability') {
      if (svNo) return /^no\b|no,|do ?n.?t ?have|do ?not ?have/i.test(ot);
      if (svYes) return /^yes\b|yes,|i ?have/i.test(ot);
    }
    if (kind === 'yesno' || kind === 'veteran' || kind === 'disability') {
      if (svYes) return /\byes\b|\btrue\b/i.test(ot) && !/\bno\b/i.test(ot.slice(0, 4));
      if (svNo) return /\bno\b|\bfalse\b/i.test(ot) && !/\byes\b/i.test(ot.slice(0, 5));
    }

    if (sv === 'yes') return /\byes\b|\btrue\b/i.test(ot);
    if (sv === 'no') return /\bno\b|\bfalse\b/i.test(ot) && !/\bnot\b/i.test(ot);
    const a = sv.replace(/[^a-z0-9]/g, '');
    const b = lc(ot).replace(/[^a-z0-9]/g, '');
    if (a === b) return true;
    if (a.length > 3 && b.length > 3 && (b.includes(a) || a.includes(b))) return true;
    return false;
  }

  // Pick the best <option> text for a native select. Returns index or -1.
  function pickOption(optionTexts, value, kind) {
    if (!value) return -1;
    const vN = lc(value).replace(/[^a-z0-9]/g, '');
    for (let i = 0; i < optionTexts.length; i++) {
      const t = lc(optionTexts[i]).replace(/[^a-z0-9]/g, '');
      if (t && (t === vN)) return i;
    }
    for (let i = 0; i < optionTexts.length; i++) {
      const t = lc(optionTexts[i]).replace(/[^a-z0-9]/g, '');
      if (t && t.length > 2 && (t.includes(vN) || vN.includes(t))) return i;
    }
    if (kind) {
      for (let i = 0; i < optionTexts.length; i++) {
        if (i === 0 && /select|choose|make a selection/i.test(optionTexts[i])) continue;
        if (matchOption(value, optionTexts[i], kind)) return i;
      }
    }
    return -1;
  }

  const api = { classify, detectSection, detectKey, resolveValue, resolveEntry, isEntryKey, entryListFor, buildProfile, matchOption, pickOption, kindFor, SINGLE_FILL, words };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JFMatcher = api;
})(typeof self !== 'undefined' ? self : this);
