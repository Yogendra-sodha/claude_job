# ATS form samples

Real form structures captured from job application pages. The autofill engine's
matchers are written and tested against these files instead of guesses.

## How to capture a site (1 minute each)

1. Open the actual application form (the page with First Name / Email fields —
   not the job list).
2. Press **F12** → **Console** tab.
   - If Chrome warns about pasting, type `allow pasting` and press Enter once.
   - If the form is embedded on a company page (Greenhouse embeds): use the
     dropdown at the top-left of the Console that says `top` and select the
     `job-boards.greenhouse.io` frame first. (Or just open the form's own URL.)
3. Paste the whole contents of `capture.js` → Enter.
4. A file like `myworkdayjobs-com-fields.json` lands in **Downloads**.
5. Rename it to something clear — `workday-echostar.json`, `lever-arrive.json`,
   `greenhouse-taketwo.json`, `icims-echostar.json`, `linkedin-easyapply.json` —
   and move it into THIS folder (`claude_job/ats-samples/`).
6. Multi-step applications (Workday, Oracle): capture **each step** —
   `workday-echostar-step1.json`, `-step2.json`, etc.

## What gets captured (and what doesn't)

- ✅ Field structure: tag, type, name, id, labels, ARIA attributes, CSS class,
  dropdown option lists, required flags.
- ❌ NOT captured: anything you typed into fields, URL query strings (which can
  contain personal tokens), cookies.

Capture from: Workday, Greenhouse, Lever, LinkedIn Easy Apply, Oracle/Taleo,
iCIMS, and any company career page that misbehaves.
