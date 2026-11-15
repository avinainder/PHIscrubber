// PHI scrubbing for free-text clinical notes — the step that runs BEFORE a
// note is pasted into an LLM chat. Pure functions, no DOM, no I/O: the same
// module drives the in-browser scrub page (index.html) and the Claude Code
// prompt guard (scripts/phi-guard.mjs).
//
// Clinical notes interleave identifiers with clinical content on the same
// line, so this works at token level and substitutes typed placeholders
// ([NAME], [ID], [2025]) that keep the sentence readable.
//
// Posture: fail closed. Over-redaction costs a word; under-redaction leaks
// an identifier. Anything a rule cannot classify but that looks like a
// proper noun is surfaced as a `review` span for the human to judge —
// pattern matching alone is never the last line of defence.

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|' +
  'Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|' +
  'JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|' +
  'SEPT?(?:EMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)';

// Words that are never (learned as) a person's name: credentials, titles,
// field labels and everyday capitalised words.
const STOP = new Set(`
jr sr ii iii iv md do np pa rn phd mbbs aprn fnp cnp pharmd facc fscai facs frcp dr mr mrs ms miss mx prof
the a an and or of for to in on at by with from is was has had he she they his her their him
patient pt name male female man woman gentleman lady unknown none na not no yes see per
mrn dob sex age gender date csn acct dos phone fax tel email address unit room bed
cardiology cardiologist surgery surgeon medicine clinic hospital service team staff attending
fellow resident physician provider doctor nurse practitioner assistant structural heart valve
interventional cardiac thoracic vascular internal primary care referring referred signed
electronically dictated history present illness assessment plan impression summary
today yesterday tomorrow this that these those who which when where
`.trim().split(/\s+/));

// Capitalised words that are clinical vocabulary, not identifiers — keeps the
// `review` pass from flagging every brand name and eponym in a TAVR note.
const CLINICAL = new Set(`
sapien ultra resilia evolut fx pro corevalve navitor portico acurate neo lotus sentinel
watchman amulet mitraclip pascal triclip magna ease perimount inspiris mosaic hancock epic
trifecta mitroflow freestyle avalus crown biocor edwards medtronic abbott boston scientific
mensio vitrea agatston valsalva bernoulli doppler holter swan ganz impella perclose proglide
manta angioseal safari confida lunderquist amplatz judkins
parkinson alzheimer hodgkin crohn graves hashimoto barrett raynaud marfan ehlers danlos
takotsubo brugada wolff white mobitz wenckebach heyde kussmaul cheyne stokes
eliquis apixaban xarelto rivaroxaban pradaxa dabigatran coumadin warfarin plavix clopidogrel
brilinta ticagrelor effient prasugrel aspirin lasix furosemide bumex torsemide lipitor crestor
entresto jardiance farxiga metoprolol toprol coreg carvedilol lisinopril losartan valsartan
amlodipine norvasc digoxin amiodarone synthroid levothyroxine metformin insulin lantus
ozempic heparin lovenox tylenol protonix omeprazole flomax
medicare medicaid english spanish portuguese mandarin cantonese french italian russian
covid sars influenza american european society college association
hgb hct plt wbc bun inr bnp trop vmax vti lvot echo cath labs meds temp resp
monday tuesday wednesday thursday friday saturday sunday
`.trim().split(/\s+/));

const US_STATE =
  '(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|' +
  'NM|NY|NC|ND|OH|OK|OR|PA|PR|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)';

// A full stop belongs to a name token only on an initial or short
// abbreviation ("A.", "Jr.") — otherwise it ends the sentence, and the name.
const NAME_TOKEN = "(?:[A-Z][a-z]?\\.|[A-Z][A-Za-z'’-]*)";
const FIELD_WORD = '(?!(?:MRN|DOB|Sex|Age|Gender|Date|CSN|Acct|DOS|Phone|Fax|Tel|Email|Address|Room|Unit)\\b)';
// A run of name-shaped tokens: "DOE, JANE", "Jane Q. Doe", "Dr. Alisa Chen, MD"
const NAMEISH = new RegExp(
  `(?:(?:Dr|Mr|Mrs|Ms|Miss|Mx|Prof)\\.?[ \\t]+)?${FIELD_WORD}${NAME_TOKEN}` +
  `(?:(?:,[ \\t]?|[ \\t])${FIELD_WORD}${NAME_TOKEN}){0,4}`, 'y');

const PATIENT_LABEL = /\b(?:patient(?:'s)?(?:\s+name)?|pt(?:\.|\s+name)?|(?:legal\s+|preferred\s+|full\s+)?name)\s*[:=]\s*/gi;
const CLINICIAN_LABEL = new RegExp(
  '\\b(?:(?:electronically\\s+)?(?:signed|authenticated|dictated|transcribed|co-?signed|reviewed|' +
  'performed|interpreted|read|ordered|seen|evaluated|prepared|entered)\\s+by\\s*:?' +
  '|(?:attending(?:\\s+(?:physician|provider|surgeon|cardiologist))?|author|provider|' +
  'ordering(?:\\s+(?:physician|provider))?|reading\\s+physician|pcp|' +
  'primary\\s+care(?:\\s+(?:physician|provider|doctor))?|cardiologist|surgeon|operator|' +
  'fellow|resident|staff|cc)\\s*:)\\s*', 'gi');
const REFERRING_LABEL = new RegExp(
  '\\b(?:referring(?:\\s+(?:physician|provider|md|cardiologist|doctor))?\\s*:' +
  '|referr(?:ed|al)\\s+(?:by|from)\\s*:?|dear)\\s+', 'gi');
const ID_LABEL = new RegExp(
  '\\b(?:MRN|MR\\s?#|medical\\s+record(?:\\s+(?:number|no\\.?|#))?|acct\\.?(?:\\s+(?:no\\.?|#))?|' +
  'account(?:\\s+(?:number|no\\.?|#))?|accession(?:\\s+(?:number|no\\.?|#))?|acc\\s?#|CSN|FIN|HAR|' +
  'encounter(?:\\s+(?:id|number|no\\.?|#))|visit(?:\\s+(?:id|number|#))|member\\s+id|' +
  'subscriber\\s+id|policy(?:\\s+(?:number|no\\.?|#))?|insurance\\s+id|order(?:\\s+(?:number|#))|' +
  'study\\s+id|exam(?:\\s+(?:id|#))|SSN|social\\s+security(?:\\s+(?:number|no\\.?|#))?|' +
  'serial(?:\\s+(?:number|no\\.?|#))?|S\\/N|lot(?:\\s+(?:number|no\\.?|#))?|license(?:\\s+(?:number|no\\.?|#))?|' +
  'NPI|DEA)\\s*[:#=]?\\s*', 'gi');
const ID_VALUE = /[A-Za-z0-9][A-Za-z0-9-]{2,}/y;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fullYear(y, nowYear) {
  let n = Number(y);
  if (y.length <= 2) n += n <= nowYear % 100 ? 2000 : 1900;
  return n;
}

/**
 * Find every span of `text` that should be redacted, kept-on-purpose, or
 * shown to the reviewer.
 *
 * opts:
 *   keepReferring  keep the referring physician's name (the slide routes the
 *                  post-procedure letter by it). Default true.
 *   keepYear       reduce dates to their year (Safe Harbor permits the year).
 *                  Default true.
 *   dropSocial     remove Social/Family History sections wholesale. Default true.
 *   extraTerms     strings the user always wants removed (patient name, town…).
 *   allowTerms     words the reviewer has cleared — never flagged or redacted
 *                  by the name/propagation/review rules.
 *   now            Date used for the age-over-89 year cutoff.
 *
 * Returns { spans, names } — spans are non-overlapping, sorted by start:
 *   { start, end, type, kind: 'redact' | 'keep' | 'review', repl }
 */
export function findSpans(text, opts = {}) {
  const {
    keepReferring = true, keepYear = true, dropSocial = true,
    extraTerms = [], allowTerms = [], now = new Date(),
  } = opts;
  const nowYear = now.getFullYear();
  const allow = new Set(allowTerms.map((t) => t.toLowerCase()));
  const cands = [];
  const learned = new Set();
  const add = (start, end, type, repl, pri, kind = 'redact') => {
    if (end > start) cands.push({ start, end, type, repl, pri, kind });
  };
  const each = (re, fn) => {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text));) {
      if (m[0] === '') { re.lastIndex++; continue; }
      fn(m);
    }
  };
  const isNameWord = (w) => {
    const l = w.toLowerCase().replace(/\.$/, '');
    return l.length >= 2 && /[a-z]/i.test(l) && !STOP.has(l) && !allow.has(l);
  };
  const learn = (value) => {
    for (const tok of value.split(/[^A-Za-z'’-]+/)) {
      if (isNameWord(tok) && !CLINICAL.has(tok.toLowerCase())) learned.add(tok);
    }
  };
  /** Name-shaped run starting exactly at `at`; null when there is none. */
  const nameAt = (at) => {
    NAMEISH.lastIndex = at;
    const m = NAMEISH.exec(text);
    if (!m) return null;
    let v = m[0].replace(/[\s,]+$/, '').replace(/['’]s$/, '');
    // A trailing stop word ("… Chen Cardiology") is not part of the name;
    // a trailing initial ("DOE, JANE Q") is.
    for (;;) {
      const cut = v.match(/^(.*\S)[\s,]+(\S+)$/);
      if (!cut || !STOP.has(cut[2].toLowerCase().replace(/\.$/, ''))) break;
      v = cut[1];
    }
    return v.split(/[^A-Za-z'’-]+/).some(isNameWord) ? v : null;
  };

  // --- Whole sections ------------------------------------------------------
  if (dropSocial) {
    const head = /^[ \t]*(?:social(?:\s+(?:and|&|\/)\s*family)?|family(?:\s*(?:and|&|\/)\s*social)?)\s+(?:history|hx)\b[^\n]*|^[ \t]*(?:SH|FH|SHx|FHx)\s*:[^\n]*/gim;
    const nextHead = /^[ \t]*(?:[A-Z][A-Za-z/&,' -]{1,48}:|[A-Z][A-Z /&-]{3,48}$)/;
    each(head, (m) => {
      let end = m.index + m[0].length;
      let content = /:\s*\S/.test(m[0]);
      const lines = text.slice(end).split('\n');
      let pos = end;
      for (let i = 1; i < lines.length; i++) { // lines[0] is the header's own remainder
        const line = lines[i];
        if (nextHead.test(line)) break;
        if (!line.trim()) { if (content) break; pos += line.length + 1; continue; }
        content = true;
        pos += line.length + 1;
        end = pos;
      }
      const label = /fam/i.test(m[0]) && !/soc/i.test(m[0]) ? 'FAMILY' : 'SOCIAL';
      add(m.index, end, 'section', `[${label} HISTORY REMOVED]`, 95);
    });
  }

  // --- Labelled fields -----------------------------------------------------
  each(PATIENT_LABEL, (m) => {
    const at = m.index + m[0].length;
    const v = nameAt(at);
    if (v) { add(at, at + v.length, 'name', '[NAME]', 80); learn(v); }
  });
  each(CLINICIAN_LABEL, (m) => {
    const at = m.index + m[0].length;
    const v = nameAt(at);
    if (v) { add(at, at + v.length, 'name', '[CLINICIAN]', 78); learn(v); }
  });
  each(REFERRING_LABEL, (m) => {
    const at = m.index + m[0].length;
    const v = nameAt(at);
    if (!v) return;
    if (keepReferring) add(at, at + v.length, 'referring', null, 100, 'keep');
    else { add(at, at + v.length, 'name', '[CLINICIAN]', 78); learn(v); }
  });
  each(ID_LABEL, (m) => {
    const at = m.index + m[0].length;
    ID_VALUE.lastIndex = at;
    const v = ID_VALUE.exec(text);
    if (v && /\d/.test(v[0])) add(at, at + v[0].length, 'id', '[ID]', 85);
  });
  each(/\b(?:address|home\s+address|street|employer|occupation|profession|emergency\s+contact|next\s+of\s+kin|contact\s+person|guardian|health\s?care\s+proxy|HCP)\s*:[ \t]*([^\n]+)/gi, (m) => {
    const at = m.index + m[0].length - m[1].length;
    const kind = /address|street/i.test(m[0]) ? '[ADDRESS]' : /employer|occupation|profession/i.test(m[0]) ? '[OCCUPATION]' : '[CONTACT]';
    add(at, at + m[1].trimEnd().length, 'detail', kind, 76);
    if (kind === '[CONTACT]') { const v = nameAt(at); if (v) learn(v); }
  });

  // --- Structured identifiers ---------------------------------------------
  each(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => add(m.index, m.index + m[0].length, 'contact', '[EMAIL]', 90));
  each(/\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+/gi, (m) => add(m.index, m.index + m[0].length, 'contact', '[URL]', 90));
  each(/\b\d{3}-\d{2}-\d{4}\b/g, (m) => add(m.index, m.index + m[0].length, 'id', '[SSN]', 88));
  each(/(?<![\d.])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)(?:\s?(?:x|ext\.?)\s?\d{1,6})?/g,
    (m) => add(m.index, m.index + m[0].length, 'contact', '[PHONE]', 86));
  each(/\b(?:phone|tel(?:ephone)?|cell|mobile|fax|pager|call(?:back)?)\b[^\n\d]{0,14}([\d(+][\d\s().-]{5,}\d)/gi, (m) => {
    const at = m.index + m[0].length - m[1].length;
    add(at, at + m[1].length, 'contact', '[PHONE]', 86);
  });
  each(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => add(m.index, m.index + m[0].length, 'id', '[IP]', 84));
  // Unlabelled record numbers: long digit runs and letter-prefixed serials
  each(/(?<![\d.,])\d{7,}(?!\d|\.\d)/g, (m) => add(m.index, m.index + m[0].length, 'id', '[ID]', 60));
  each(/\b[A-Z]{1,4}-?\d{5,}\b/g, (m) => add(m.index, m.index + m[0].length, 'id', '[ID]', 60));

  // --- Dates ---------------------------------------------------------------
  const date = (m, year) => {
    const start = m.index, end = m.index + m[0].length;
    const before = text.slice(Math.max(0, start - 24), start);
    if (/(?:\bDOB|\bD\.O\.B\.?|date\s+of\s+birth|birth\s?date|\bborn(?:\s+on)?)\s*[:=]?\s*\(?$/i.test(before)) {
      return add(start, end, 'date', '[DOB]', 72);
    }
    const y = year ? fullYear(year, nowYear) : null;
    // A year old enough to imply an age over 89 is itself an identifier
    const repl = keepYear && y && y > nowYear - 90 && y <= nowYear + 1 ? `[${y}]` : '[DATE]';
    add(start, end, 'date', repl, 70);
  };
  // 05/12/1958, 5-12-58 — month validated, and never a measurement triplet
  // ("NxRxL: 30/30/30 mm"): a date is not followed by a length unit.
  each(/\b(?:(?:0?[1-9]|1[0-2])[/\-.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2]))[/\-.](\d{4}|\d{2})\b(?!\s*[cm]m\b)/g,
    (m) => date(m, m[1]));
  each(/\b((?:19|20)\d{2})[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:0?[1-9]|[12]\d|3[01])\b(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M|Z)?)?/g,
    (m) => date(m, m[1]));
  each(/\b(?:0?[1-9]|1[0-2])\/((?:19|20)\d{2})\b/g, (m) => date(m, m[1]));
  each(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?[\\s-]+${MONTH}\\.?,?[\\s-]+(\\d{4})\\b`, 'g'), (m) => date(m, m[1]));
  each(new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?!\\s*(?:mg|mcg|ml|mm|cm|%|units?)\\b)(?:,?\\s+(\\d{4})\\b)?`, 'g'),
    (m) => date(m, m[1]));
  each(new RegExp(`\\b${MONTH}\\.?,?\\s+(?:of\\s+)?((?:19|20)\\d{2})\\b`, 'g'), (m) => date(m, m[1]));

  // --- Ages over 89 --------------------------------------------------------
  const age = (m, numStr) => {
    const n = Number(numStr);
    if (n < 90 || n > 124) return;
    const at = m.index + m[0].indexOf(numStr);
    if (/(?:temp(?:erature)?|\bT|°)\s*:?\s*$/i.test(text.slice(Math.max(0, at - 14), at))) return;
    add(at, at + numStr.length, 'age', '>89', 74);
  };
  each(/(?<![\d.])(\d{2,3})\s*-?\s*(?:(?:years?|yrs?)[\s-]*old\b|y\/o\b|y\.o\.|yo\b|yrs?\b|y\b)/gi, (m) => age(m, m[1]));
  each(/(?<![\d./])(\d{2,3})\s?(?:M|F)\b/g, (m) => age(m, m[1]));
  each(/\bage[d:]?\s+(\d{2,3})\b/gi, (m) => age(m, m[1]));

  // --- Addresses and places ------------------------------------------------
  each(/\b\d{1,6}\s+(?:[A-Z][A-Za-z'.-]*\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Square|Sq)\b\.?(?:\s+(?:North|South|East|West|N|S|E|W|NE|NW|SE|SW)\b\.?)?(?:,?\s+(?:Apt|Apartment|Unit|Suite|Ste|#)\.?\s*#?\s*[A-Za-z0-9-]+)?/g,
    (m) => add(m.index, m.index + m[0].length, 'place', '[ADDRESS]', 82));
  each(/\bP\.?\s?O\.?\s+Box\s+\d+/gi, (m) => add(m.index, m.index + m[0].length, 'place', '[ADDRESS]', 82));
  // "Quincy, MA 02169". City words are Capitalised (never an ALL-CAPS
  // abbreviation: "RBBB, PR 210"). MD and PA are states AND credentials, so
  // those two need the ZIP to count.
  each(new RegExp(`\\b[A-Z][a-z'.-]+(?:[ \\t]+[A-Z][a-z'.-]+){0,2},[ \\t]*(${US_STATE})\\b([ \\t]+\\d{5}(?:-\\d{4})?)?`, 'g'), (m) => {
    if (/^(?:MD|PA)$/.test(m[1]) && !m[2]) return;
    add(m.index, m.index + m[0].length, 'place', '[LOCATION]', 68);
  });
  each(/\b\d{5}-\d{4}\b/g, (m) => add(m.index, m.index + m[0].length, 'place', '[ZIP]', 66));
  each(/\b(?:liv(?:es|ing)|resid(?:es|ing)|resident|originally|born|raised|grew\s+up|(?:e|im)migrated|moved(?:\s+here)?|native|visiting|travel(?:s|ed|ling|ing)?)[ \t]+(?:in|at|of|from|to)[ \t]+((?:the[ \t]+)?[A-Z][A-Za-z'’-]+(?:,?[ \t]+[A-Z][A-Za-z'’-]+){0,3})/g, (m) => {
    const at = m.index + m[0].length - m[1].length;
    add(at, at + m[1].length, 'place', '[LOCATION]', 68);
  });
  each(/\b[A-Z][\w'’&.-]*(?:[ \t]+(?:and|of|the|&|for|[A-Z][\w'’&.-]*)){0,5}[ \t]+(?:Hospital|Medical\s+Cent(?:er|re)|Health\s?care|Health(?:\s+System)?|Institute|Infirmary|Rehabilitation(?:\s+Cent(?:er|re))?|Nursing\s+Home|Skilled\s+Nursing(?:\s+Facility)?|Associates|Physicians|Medical\s+Group|University|College)\b/g,
    (m) => add(m.index, m.index + m[0].length, 'place', '[FACILITY]', 64));
  each(/\b(?:work(?:s|ed|ing)?|employed)\s+(?:as|at|for|in)\s+(?:an?\s+|the\s+)?([^.,;\n]{2,60})/gi, (m) => {
    const at = m.index + m[0].length - m[1].length;
    add(at, at + m[1].trimEnd().length, 'detail', '[OCCUPATION]', 62);
  });
  each(/\bretired\s+(?!and\b|in\b|from\b|since\b|but\b|last\b|this\b|now\b|after\b|at\b|due\b|early\b)([a-z]+(?:[ \t]+(?!who\b|and\b|that\b|with\b|from\b|in\b|he\b|she\b|lives\b|living\b|now\b|but\b)[a-z]+)?)/gi, (m) => {
    const at = m.index + m[0].length - m[1].length;
    add(at, at + m[1].length, 'detail', '[OCCUPATION]', 62);
  });

  // --- Names in running text ----------------------------------------------
  const W = "[A-Z][A-Za-z'’-]+";
  each(new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Doctor|Prof|Professor)\\b\\.?\\s+((?:[A-Z]\\.\\s+)?${W}(?:\\s+${W}){0,2})`, 'g'), (m) => {
    const at = m.index + m[0].length - m[1].length;
    const v = nameAt(at);
    if (v) { add(at, at + v.length, 'name', '[NAME]', 77); learn(v); }
  });
  each(new RegExp(`\\b([A-Z][a-z'’-]+(?:\\s[A-Z]\\.)?(?:\\s${W}){1,2}),?\\s+(?:MD|M\\.D\\.|DO|NP|PA-C|PA|RN|PhD|MBBS|APRN|FNP|CNP|PharmD)\\b`, 'g'), (m) => {
    if (!m[1].split(/\s+/).every((w) => isNameWord(w) || /^[A-Z]\.$/.test(w))) return;
    add(m.index, m.index + m[1].length, 'name', '[CLINICIAN]', 77);
    learn(m[1]);
  });
  each(/\b(?:daughter|son|wife|husband|spouse|partner|brother|sister|mother|father|niece|nephew|granddaughter|grandson|grandchild|cousin|aunt|uncle|caregiver|friend|neighbou?r|proxy|aide)s?(?:-in-law)?[ \t]*[,(]?[ \t]*(?:named[ \t]+)?(?=[A-Z])/gi, (m) => {
    const at = m.index + m[0].length;
    const v = nameAt(at);
    if (!v) return;
    const first = v.split(/[\s,]+/)[0];
    if (!isNameWord(first) || CLINICAL.has(first.toLowerCase())) return;
    add(at, at + v.length, 'name', '[NAME]', 75);
    learn(v);
  });
  // Chart banner: "Smith, John A. (MRN …" / "DOE, JANE  DOB …"
  each(new RegExp(`^[ \\t]*(${W},[ \\t]*${W}(?:[ \\t][A-Z]\\.?)?)(?=[ \\t]*[(,|-]?[ \\t]*(?:MRN|DOB|MR\\s?#|\\d{1,3}[ \\t]?(?:y|yo|M|F)\\b))`, 'gm'), (m) => {
    const at = m.index + m[0].length - m[1].length;
    add(at, at + m[1].length, 'name', '[NAME]', 79);
    learn(m[1]);
  });

  // Every name learned above is removed wherever else it appears, in the
  // capitalised or ALL-CAPS form (a patient named "Long" must not eat
  // "long axis").
  for (const tok of learned) {
    const cap = tok[0].toUpperCase() + tok.slice(1).toLowerCase();
    const forms = [...new Set([tok, cap, tok.toUpperCase()])].map(escapeRe).join('|');
    each(new RegExp(`(?<![A-Za-z])(?:${forms})(?![A-Za-z])`, 'g'), (m) => add(m.index, m.index + m[0].length, 'name', '[NAME]', 50));
  }

  // --- Terms the user named ------------------------------------------------
  for (const raw of extraTerms) {
    const term = String(raw).trim();
    if (term.length < 2) continue;
    const parts = new Set([term]);
    for (const w of term.split(/[\s,;]+/)) if (w.length >= 3 && !STOP.has(w.toLowerCase())) parts.add(w);
    for (const p of parts) {
      each(new RegExp(`(?<![A-Za-z0-9])${escapeRe(p).replace(/\s+/g, '\\s+')}(?![A-Za-z0-9])`, 'gi'),
        (m) => add(m.index, m.index + m[0].length, 'custom', '[REDACTED]', 98));
    }
  }

  // --- Resolve overlaps: highest priority, then longest, wins --------------
  cands.sort((a, b) => b.pri - a.pri || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const spans = [];
  for (const c of cands) {
    if (!spans.some((s) => c.start < s.end && s.start < c.end)) spans.push(c);
  }

  // --- Review pass: leftover proper nouns ----------------------------------
  // A capitalised word mid-sentence that never appears in lower case, is not
  // clinical vocabulary and was not caught above is the shape of a missed
  // name or town. It is not removed — the reviewer decides.
  const lowerSeen = new Set(text.match(/\b[a-z][a-z'’-]+\b/g) ?? []);
  each(/[A-Z][a-z'’]+(?:-[A-Z][a-z]+)?/g, (m) => {
    const start = m.index, end = start + m[0].length;
    if (/[A-Za-z0-9]/.test(text[start - 1] ?? '') || /[A-Za-z0-9]/.test(text[end] ?? '')) return;
    const l = m[0].toLowerCase().replace(/['’]s?$/, '');
    if (l.length < 3 || STOP.has(l) || CLINICAL.has(l) || allow.has(l) || lowerSeen.has(l)) return;
    if (spans.some((s) => start < s.end && s.start < end)) return;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lead = text.slice(lineStart, start);
    if (/^[\s\-•*·\d.)]*$/.test(lead)) return;            // first word on its line
    if (/[.!?:;]["')\]]?\s+$/.test(lead)) return;         // first word of a sentence
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = text.length;
    const colon = text.indexOf(':', end);
    if (colon >= 0 && colon < lineEnd && colon - lineStart <= 48 &&
        !/[a-z]{2,}\s+[a-z]{2,}/.test(text.slice(lineStart, colon))) return; // "Past Medical History:"
    spans.push({ start, end, type: 'review', kind: 'review', repl: null, pri: 0 });
  });

  spans.sort((a, b) => a.start - b.start);
  return { spans, names: [...learned] };
}

/**
 * Build the de-identified text. `restored` holds "start:end" keys of redact
 * spans the reviewer has put back by hand.
 */
export function applySpans(text, spans, restored = new Set()) {
  let out = '';
  let pos = 0;
  for (const s of spans) {
    out += text.slice(pos, s.start);
    out += s.kind === 'redact' && !restored.has(`${s.start}:${s.end}`) ? s.repl : text.slice(s.start, s.end);
    pos = s.end;
  }
  return out + text.slice(pos);
}

/** Tally of what was removed, by type, plus how many spans still need a look. */
export function tally(spans, restored = new Set()) {
  const counts = {};
  let review = 0;
  for (const s of spans) {
    if (s.kind === 'review') review++;
    else if (s.kind === 'redact' && !restored.has(`${s.start}:${s.end}`)) counts[s.type] = (counts[s.type] ?? 0) + 1;
  }
  return { counts, review, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** One-call convenience: scrub and return the text plus the evidence. */
export function scrub(text, opts = {}) {
  const { spans, names } = findSpans(text, opts);
  return { text: applySpans(text, spans), spans, names, ...tally(spans) };
}

/**
 * High-confidence identifiers only — the prompt guard blocks on these, so a
 * false positive must be rare (an ordinary engineering prompt that mentions
 * "MRN" or a date is not PHI).
 */
export function hardIdentifiers(text) {
  const { spans } = findSpans(text, { dropSocial: false });
  const hits = new Set();
  for (const s of spans) {
    if (s.kind !== 'redact') continue;
    const before = text.slice(Math.max(0, s.start - 40), s.start);
    if (s.repl === '[SSN]') hits.add('SSN');
    else if (s.repl === '[DOB]') hits.add('date of birth');
    else if (s.type === 'id' && /MRN|medical\s+record|MR\s?#|CSN|accession|acc\s?#/i.test(before)) hits.add('record number');
    else if (s.repl === '[NAME]' && /patient(?:'s)?(?:\s+name)?\s*[:=]\s*$/i.test(before)) hits.add('patient name');
    else if (s.repl === '[PHONE]') hits.add('phone number');
    else if (s.repl === '[ADDRESS]') hits.add('street address');
  }
  return [...hits];
}
