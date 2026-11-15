// The scrubber's contract: identifiers out, clinical content intact. Every
// name, number and address below is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, findSpans, applySpans, hardIdentifiers } from '../src/phiScrub.js';

const NOW = new Date('2026-11-15T12:00:00Z');
const run = (text, opts = {}) => scrub(text, { now: NOW, ...opts });

const NOTE = `Patient Name: DOE, JANE Q   MRN: 12345678
DOB: 05/12/1941   Sex: F
Date of Service: 10/02/2026
Referring Physician: Dr. Alisa Chen

Dear Alisa,

Thank you for referring Mrs. Doe, an 85 year old woman with Parkinson's disease
and severe aortic stenosis, for consideration of TAVR. Jane lives in Quincy with
her daughter Mary and worked as a school librarian. She can be reached at
(617) 555-0142 or jane.doe@example.com. Home address: 14 Maple Street, Quincy, MA 02169.

Medications: Apixaban 5 mg BID, ASA 81.
Labs 09/28/2026: Cr 0.9, Hgb 12.1, Plt 210.
ECG: NSR, RBBB, PR 210.
TTE 9/15/2026 at Riverbend Medical Center: EF 60%, Vmax 4.3 m/s, MG 45 mmHg, AVA 0.7 cm2, RVSP 38.
Cath March 3, 2025: 70% mid RCA, otherwise mild. Exam: 3/6 systolic murmur. BP 132/78.
SoV Diameter NxRxL: 30/30/30 mm. STS 2.69%.

Social History: Widowed. Retired librarian. Attends St. Brendan parish.
Never smoker.

Assessment: Dr. Chen's patient is a reasonable TAVR candidate.

Electronically signed by Robert Okafor, MD on 10/02/2026 14:32
`;

test('removes direct identifiers from a consult note', () => {
  const { text } = run(NOTE);
  for (const leak of [
    'DOE', 'Doe', 'JANE', 'Jane', 'Mary', '12345678', '1941', '05/12', '10/02/2026',
    '555-0142', 'example.com', 'Maple', 'Quincy', '02169', 'Okafor', 'Robert',
    'Riverbend', 'librarian', 'Brendan', 'Widowed', '09/28', '9/15',
  ]) {
    assert.ok(!text.includes(leak), `leaked: ${leak}\n${text}`);
  }
});

test('keeps the clinical content the slide is built from', () => {
  const { text } = run(NOTE);
  for (const keep of [
    '85 year old woman', "Parkinson's disease", 'severe aortic stenosis', 'Apixaban 5 mg BID',
    'ASA 81', 'Cr 0.9, Hgb 12.1, Plt 210', 'NSR, RBBB, PR 210', 'EF 60%', 'Vmax 4.3 m/s',
    'MG 45 mmHg', 'AVA 0.7 cm2', '70% mid RCA', '3/6 systolic murmur', 'BP 132/78',
    '30/30/30 mm', 'STS 2.69%', 'Sex: F',
  ]) {
    assert.ok(text.includes(keep), `lost: ${keep}\n${text}`);
  }
});

test('dates reduce to the year; a date of birth goes entirely', () => {
  const { text } = run(NOTE);
  assert.match(text, /Cath \[2025\]: 70% mid RCA/);
  assert.match(text, /Labs \[2026\]: Cr 0\.9/);
  assert.match(text, /DOB: \[DOB\]/);
  assert.equal(run('Seen on March 14th for follow-up.').text, 'Seen on [DATE] for follow-up.');
  assert.equal(run('Cath 2019 was clean.').text, 'Cath 2019 was clean.', 'a bare year is not an identifier');
  assert.equal(run('Admitted 2026-08-16 08:15 overnight.').text, 'Admitted [2026] overnight.');
});

test('a year that implies an age over 89 is not kept', () => {
  assert.equal(run('CABG 06/1931 elsewhere.').text, 'CABG [DATE] elsewhere.');
});

test('referring physician is kept by default and removable', () => {
  const kept = run(NOTE).text;
  assert.match(kept, /Referring Physician: Dr\. Alisa Chen/);
  assert.match(kept, /Dear Alisa,/);
  const dropped = run(NOTE, { keepReferring: false }).text;
  assert.ok(!dropped.includes('Chen') && !dropped.includes('Alisa'), dropped);
});

test('ages over 89 are capped, younger ages untouched', () => {
  assert.equal(run('A 93 year old man with AS.').text, 'A >89 year old man with AS.');
  assert.equal(run('92F with severe AS').text, '>89F with severe AS');
  assert.equal(run('91 yo M').text, '>89 yo M');
  assert.equal(run('A 78 year old man.').text, 'A 78 year old man.');
  assert.equal(run('Temp 98 F, HR 92.').text, 'Temp 98 F, HR 92.');
});

test('measurements are never mistaken for identifiers', () => {
  const m = `Annulus Area/Avg Diameter: 406 mm2 / 22.9 mm
Sinus heights L/R/N 12/10/11 mm
STJ Diameter (Max/Min): 28.1 / 26.4 mm
Calcium Score: 2150, Plt 250000
LMCA Coronary Height: 13.8 mm`;
  const r = run(m);
  assert.equal(r.text, m);
  assert.equal(r.total, 0);
});

test('a learned name is removed everywhere, but not its lower-case homograph', () => {
  const { text } = run('Patient: Long, Mary\nMs. Long reports dyspnea. The long axis view shows LONG, MARY.');
  assert.ok(!/Long\b/.test(text) && !text.includes('LONG') && !text.includes('Mary'), text);
  assert.ok(text.includes('long axis'), text);
});

test('user-supplied terms are removed case-insensitively, word by word', () => {
  const { text } = run('jane was seen with her sister. J. Doe agrees. Lives near fenway.', {
    extraTerms: ['Jane Doe', 'Fenway'],
  });
  assert.ok(!/jane|doe|fenway/i.test(text), text);
});

test('social and family history sections are dropped as a block', () => {
  const { text } = run(NOTE);
  assert.match(text, /\[SOCIAL HISTORY REMOVED\]\n\nAssessment:/);
  assert.ok(run(NOTE, { dropSocial: false }).text.includes('Never smoker'));
});

test('record numbers, SSNs and device serials', () => {
  const { text } = run('Acc # A-99887, CSN 4455667, SSN 123-45-6789. Valve serial number: 8812345. Chart 20481357.');
  for (const leak of ['A-99887', '4455667', '123-45-6789', '8812345', '20481357']) {
    assert.ok(!text.includes(leak), `leaked ${leak}: ${text}`);
  }
});

test('unrecognised proper nouns are surfaced for review, clinical terms are not', () => {
  const { spans } = findSpans('She saw Okonkwo last week and takes Eliquis; the Sapien valve was discussed in Dorchester.', { now: NOW });
  const flagged = spans.filter((s) => s.kind === 'review').map((s) => s.start);
  const words = flagged.map((i) => 'She saw Okonkwo last week and takes Eliquis; the Sapien valve was discussed in Dorchester.'.slice(i).match(/^\w+/)[0]);
  assert.deepEqual(words, ['Okonkwo', 'Dorchester']);
});

test('a restored span goes back to the original text', () => {
  const src = 'Seen at Riverbend Medical Center on 10/02/2026.';
  const { spans } = findSpans(src, { now: NOW });
  const fac = spans.find((s) => s.repl === '[FACILITY]');
  assert.equal(applySpans(src, spans, new Set([`${fac.start}:${fac.end}`])), 'Seen at Riverbend Medical Center on [2026].');
});

test('prompt guard fires on hard identifiers only', () => {
  assert.deepEqual(hardIdentifiers('Fix the MRN regex so dates like 30/30/30 mm survive').sort(), []);
  assert.deepEqual(hardIdentifiers('Bump the version and update the changelog for 2026-10-04'), []);
  assert.deepEqual(hardIdentifiers(NOTE).sort(),
    ['date of birth', 'patient name', 'phone number', 'record number', 'street address']);
});
