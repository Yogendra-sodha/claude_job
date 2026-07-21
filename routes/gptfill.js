// POST /api/gpt-fill
// Answers the application questions the rule-matcher couldn't, using an
// OpenAI-COMPATIBLE chat-completions endpoint. Works with OpenAI, DeepSeek,
// Moonshot (Kimi), Z.ai (GLM), OpenRouter, or a local Ollama — the base URL,
// model and key are all read from Settings, so switching providers is a config
// change. The API key never leaves the server.

const express = require('express');
const router = express.Router();
const { query } = require('../db');

const DEFAULT_BASE = 'https://api.openai.com/v1';

function buildContext(profile) {
  let d = {};
  try { d = JSON.parse(profile.demographics || '{}'); } catch (e) {}
  return {
    name: profile.name || '',
    title: profile.title || '',
    email: profile.email || '',
    phone: profile.phone || '',
    location: profile.location || '',
    linkedin: profile.linkedin || '',
    portfolio: profile.portfolio || '',
    yearsOfExperience: profile.years || '',
    summary: profile.summary || '',
    skills: profile.skills || '',
    experienceText: profile.experience || '',
    education: Array.isArray(d.educationList) ? d.educationList : [],
    workHistory: Array.isArray(d.workList) ? d.workList : [],
    workAuthorization: d.authorized || '',
    needsVisaSponsorship: d.sponsorship || '',
    willingToRelocate: d.relocate || '',
    salaryExpectation: d.salary || '',
    noticePeriod: d.notice || '',
    howHeard: d.source || '',
    gender: d.gender || '',
    raceEthnicity: d.race || '',
    veteranStatus: d.veteran || '',
    disabilityStatus: d.disability || '',
  };
}

const SYSTEM_PROMPT =
  'You help a job applicant complete an application form using ONLY the facts in their profile. ' +
  'For each question, produce the best answer:\n' +
  '- If the question has an "options" array, return EXACTLY one of those option strings, copied verbatim.\n' +
  '- If it is open-ended, write a concise, specific, professional answer grounded in the profile ' +
  '(2-4 sentences unless the question clearly needs more). Write in the first person as the candidate.\n' +
  '- NEVER invent facts not in the profile (employers, dates, numbers, certifications, citizenship, addresses).\n' +
  '- If the profile lacks the information and you cannot reasonably answer, return an empty string "" for that answer ' +
  '(do not guess for factual/eligibility questions).\n' +
  'Respond with ONLY this JSON, no prose: {"answers":[{"id":"<id>","answer":"<text>"}]}';

router.post('/', async (req, res) => {
  try {
    const questions = Array.isArray(req.body.questions) ? req.body.questions.slice(0, 40) : [];
    if (!questions.length) return res.json({ answers: [] });

    const settings = (await query('SELECT * FROM settings WHERE id = 1')).rows[0] || {};
    const apiKey = (settings.api_key || '').trim();
    const base = (settings.api_base || DEFAULT_BASE).trim().replace(/\/+$/, '');
    const model = (settings.model || 'gpt-5').trim();
    if (!apiKey) return res.status(400).json({ error: 'No API key set — add one in Settings → AI.' });

    const profile = (await query('SELECT * FROM profiles WHERE id = 1')).rows[0] || {};
    const ctx = buildContext(profile);

    const userMsg =
      'CANDIDATE PROFILE (the only facts you may use):\n' + JSON.stringify(ctx) +
      '\n\nQUESTIONS to answer:\n' +
      JSON.stringify(questions.map((q) => ({ id: q.id, question: q.label, type: q.type, options: q.options || undefined })));

    const body = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      // Ask for JSON where supported; harmlessly ignored elsewhere, and we also
      // defensively extract JSON from the text below.
      response_format: { type: 'json_object' },
    };

    let r;
    try {
      r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return res.status(502).json({ error: 'Could not reach the AI provider (' + base + '): ' + e.message });
    }

    if (!r.ok) {
      let detail = '';
      try { detail = (await r.text()).slice(0, 400); } catch (e) {}
      // Retry once without response_format for providers/models that reject it
      if (/response_format|unsupported|invalid/i.test(detail)) {
        delete body.response_format;
        r = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body: JSON.stringify(body),
        });
        if (!r.ok) { try { detail = (await r.text()).slice(0, 400); } catch (e) {} }
      }
      if (!r.ok) return res.status(502).json({ error: 'AI provider error ' + r.status + ': ' + detail });
    }

    const data = await r.json();
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const m = content.match(/\{[\s\S]*\}/);
      try { parsed = m ? JSON.parse(m[0]) : { answers: [] }; } catch (e2) { parsed = { answers: [] }; }
    }
    const answers = Array.isArray(parsed.answers) ? parsed.answers.filter((a) => a && a.id != null) : [];
    res.json({ answers, model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
