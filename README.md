# PHI Scrubber

De-identify a clinical note **in your browser** before pasting it into Claude
(or any LLM). The original text never leaves the page; only the scrubbed text
is copied out.

## Use

```bash
python3 dev-server.py
```

Then open <http://localhost:8742>. No build step, no dependencies. It is a
static site, so it can also be hosted anywhere that serves files — the
scrubbing still runs on your device.

1. Paste the note, or drop a PDF or a screenshot.
2. Type the patient's name under **Always remove** — the most reliable way to
   catch every mention, including nicknames.
3. Read the scrubbed pane. Amber words look like a missed name or place:
   click to remove or clear them. Click any removal to put it back. Select
   text and press **Remove selected text** for anything else.
4. **Copy scrubbed text** and paste that into Claude.

## What it removes

| Kind | Becomes |
| --- | --- |
| Patient, relative and clinician names | `[NAME]`, `[CLINICIAN]` |
| MRN, accession, account, SSN, device serials, long digit runs | `[ID]`, `[SSN]` |
| Dates | the year only, e.g. `[2025]`; `[DATE]` when there is no year or the year implies an age over 89 |
| Date of birth | `[DOB]` |
| Phone, fax, email, URL | `[PHONE]`, `[EMAIL]`, `[URL]` |
| Street addresses, city/state/ZIP, "lives in …" | `[ADDRESS]`, `[LOCATION]` |
| Hospitals, clinics, practices | `[FACILITY]` |
| Occupation and employer | `[OCCUPATION]` |
| Ages 90 and over | `>89` |
| Social and family history sections | removed as a block (optional) |

The referring physician's name is kept by default (a checkbox removes it).

## Guarantees and limits

- `index.html` carries a Content-Security-Policy that forbids any connection
  off the page's own origin. Nothing is written to storage. PDF text
  extraction (pdf.js) and screenshot OCR (tesseract.js) are vendored and run
  locally.
- Pattern rules miss things: a misspelled name, an unlabelled ALL-CAPS name,
  a rare diagnosis paired with a small town. **The person reading the
  scrubbed pane is the final check.**
- This is a workflow safeguard, not a certified de-identification method
  (neither HIPAA Safe Harbor attestation nor Expert Determination). Your
  institution's policy on AI tools still applies.

## Prompt guard (optional, Claude Code only)

`scripts/phi-guard.mjs` is a `UserPromptSubmit` hook that blocks a prompt
carrying an MRN, date of birth, SSN or labelled patient name. To use it in
another project, copy the hook entry from `.claude/settings.json` and point
it at this script.

It only prevents transmission in Claude Code running on your own machine. In
cloud sessions and in claude.ai chat the text has already left your device
before any hook runs — there, the scrub page is the only protection.
`PHI_GUARD=off` bypasses it for synthetic fixtures.

## Develop

```bash
node --test
```

Rules live in `src/phiScrub.js` (pure functions, no DOM); the page controller
is `src/app.js`. Every name and number in `test/` is invented — never commit
a real note as a fixture.
