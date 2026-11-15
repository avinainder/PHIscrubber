#!/usr/bin/env node
// Claude Code UserPromptSubmit hook — a tripwire, not the scrubber. It reads
// the prompt about to be submitted and BLOCKS it (exit 2) when it carries
// hard patient identifiers, pointing back at the scrub page.
//
// Where it helps: Claude Code on your own machine, where the hook runs
// before the prompt is sent to the model. In a cloud session the prompt has
// already left your device by the time any hook runs, and claude.ai chat has
// no hooks at all — there, the scrub page is the only protection.
//
// Bypass for a deliberate synthetic fixture: PHI_GUARD=off

import { hardIdentifiers } from '../src/phiScrub.js';

if (process.env.PHI_GUARD === 'off') process.exit(0);

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let prompt = '';
try { prompt = JSON.parse(raw).prompt ?? ''; } catch { process.exit(0); }

const hits = hardIdentifiers(prompt);
// One record number or DOB is enough; softer signals need company.
const hard = hits.some((h) => ['SSN', 'date of birth', 'record number', 'patient name'].includes(h));
if (hard || hits.length >= 2) {
  // Name the KINDS found, never the values — this message is itself logged.
  process.stderr.write(
    `Prompt blocked: it looks like it contains patient identifiers (${hits.join(', ')}).\n` +
    'Scrub it first with the PHI Scrubber page (python3 dev-server.py, then http://localhost:8742) ' +
    'and paste the scrubbed text.\nSynthetic test data? Re-run with PHI_GUARD=off.\n');
  process.exit(2);
}
