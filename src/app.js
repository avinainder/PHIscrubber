// PHI scrub page controller. Everything here is in-memory: no storage, no
// network (index.html's CSP forbids it), and the original note never leaves
// the textarea. The only way text exits the page is the Copy button, which
// copies the SCRUBBED text.

import { findSpans, applySpans, tally } from './phiScrub.js';

const $ = (id) => document.getElementById(id);
const source = $('source');
const review = $('review');
const terms = $('terms');
const menu = $('menu');
const statusEl = $('status');

let spans = [];
const restored = new Set();   // "start:end" of redactions put back by hand
const allowTerms = new Set(); // review words the user cleared
let menuWord = null;

const extraTerms = () => terms.value.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);

function render() {
  const text = source.value;
  ({ spans } = findSpans(text, {
    keepReferring: $('opt-referring').checked,
    keepYear: $('opt-year').checked,
    dropSocial: $('opt-social').checked,
    extraTerms: extraTerms(),
    allowTerms: [...allowTerms],
  }));

  review.replaceChildren();
  if (!text.trim()) {
    const p = document.createElement('p');
    p.className = 'scrub-empty';
    p.textContent = 'The scrubbed note appears here as you paste.';
    review.append(p);
  }
  let pos = 0;
  for (const s of spans) {
    review.append(text.slice(pos, s.start));
    const key = `${s.start}:${s.end}`;
    const original = text.slice(s.start, s.end);
    const mark = document.createElement('mark');
    if (s.kind === 'redact') {
      const back = restored.has(key);
      mark.className = back ? 'r-restored' : 'r-redact';
      mark.textContent = back ? original : s.repl;
      mark.title = back ? 'Put back by you — click to remove again' : 'Removed — click to put back';
      mark.dataset.key = key;
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
    } else if (s.kind === 'review') {
      mark.className = 'r-review';
      mark.textContent = original;
      mark.title = 'Not recognised — is this a name or place?';
      mark.dataset.word = original;
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
    } else {
      mark.className = 'r-keep';
      mark.textContent = original;
      mark.title = 'Kept on purpose (referring physician)';
    }
    review.append(mark);
    pos = s.end;
  }
  review.append(text.slice(pos));

  const t = tally(spans, restored);
  const tallyEl = $('tally');
  tallyEl.textContent = text.trim()
    ? `${t.total} removed${t.review ? ` · ${t.review} to check` : ''}${restored.size ? ` · ${restored.size} put back` : ''}`
    : '';
  tallyEl.classList.toggle('has-review', t.review > 0);
  const copy = $('copy');
  copy.disabled = !text.trim();
  copy.textContent = t.review ? `Copy anyway (${t.review} unchecked)` : 'Copy scrubbed text';
}

function resetAndRender() {
  restored.clear();
  render();
}

function addTerm(term) {
  const clean = term.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) return;
  const have = extraTerms().map((t) => t.toLowerCase());
  if (!have.includes(clean.toLowerCase())) terms.value = [...extraTerms(), clean].join(', ');
  render();
}

function closeMenu() {
  menu.hidden = true;
  menuWord = null;
}

function activate(mark) {
  if (mark.dataset.key) {
    const k = mark.dataset.key;
    if (restored.has(k)) restored.delete(k); else restored.add(k);
    render();
  } else if (mark.dataset.word) {
    menuWord = mark.dataset.word;
    const r = mark.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${r.bottom + window.scrollY + 6}px`;
    menu.querySelector('button').focus();
  }
}

review.addEventListener('click', (e) => {
  const mark = e.target.closest('mark');
  if (mark && String(window.getSelection()) === '') activate(mark);
});
review.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('mark[role=button]')) {
    e.preventDefault();
    activate(e.target);
  }
});
menu.addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (!act || !menuWord) return;
  const word = menuWord;
  closeMenu();
  if (act === 'remove') addTerm(word);
  else { allowTerms.add(word.toLowerCase()); render(); }
});
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// Selecting text in the scrubbed pane arms "Remove selected text"
const selectedInReview = () => {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return '';
  return review.contains(sel.anchorNode) && review.contains(sel.focusNode) ? String(sel).trim() : '';
};
document.addEventListener('selectionchange', () => {
  const s = selectedInReview();
  $('remove-sel').disabled = !s || s.includes('\n') || s.length > 80;
});
$('remove-sel').addEventListener('click', () => {
  const s = selectedInReview();
  if (!s) return;
  window.getSelection().removeAllRanges();
  addTerm(s);
});

$('copy').addEventListener('click', async () => {
  const out = applySpans(source.value, spans, restored);
  const btn = $('copy');
  try {
    await navigator.clipboard.writeText(out);
  } catch {
    // Clipboard API refused (permissions / insecure origin): legacy path
    const ta = Object.assign(document.createElement('textarea'), { value: out });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  btn.textContent = 'Copied — scrubbed text only';
  setTimeout(render, 1600);
});

$('clear').addEventListener('click', () => {
  source.value = '';
  terms.value = '';
  allowTerms.clear();
  statusEl.textContent = '';
  resetAndRender();
  source.focus();
});

source.addEventListener('input', resetAndRender);
terms.addEventListener('input', render);
for (const id of ['opt-referring', 'opt-year', 'opt-social']) $(id).addEventListener('change', resetAndRender);

// --- PDF / screenshot intake (vendored pdf.js and tesseract, all local) ----

async function ingest(file) {
  if (!file) return;
  try {
    let text = '';
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '')) {
      statusEl.textContent = 'Reading PDF…';
      const { extractPdfText } = await import('./pdfText.js');
      text = await extractPdfText(file, 40);
      if (!text.trim()) {
        statusEl.textContent = 'This PDF has no text layer — screenshot the page and drop that instead.';
        return;
      }
    } else if (file.type.startsWith('image/')) {
      statusEl.textContent = 'Reading screenshot…';
      const { recognizeImage } = await import('./ocr.js');
      text = await recognizeImage(file, (m) => {
        if (m.status === 'recognizing text') statusEl.textContent = `Reading screenshot… ${Math.round(m.progress * 100)}%`;
      });
    } else {
      statusEl.textContent = 'Only PDFs and images can be opened.';
      return;
    }
    source.value = source.value.trim() ? `${source.value.trimEnd()}\n\n${text}` : text;
    statusEl.textContent = file.type.startsWith('image/')
      ? 'Screenshot read — OCR can misread letters, so check names carefully.'
      : 'PDF read.';
    resetAndRender();
  } catch (err) {
    statusEl.textContent = `Could not read that file (${err?.message ?? 'unknown error'}).`;
  }
}

$('open-file').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { ingest(e.target.files[0]); e.target.value = ''; });
source.addEventListener('dragover', (e) => { e.preventDefault(); source.classList.add('is-drop'); });
source.addEventListener('dragleave', () => source.classList.remove('is-drop'));
source.addEventListener('drop', (e) => {
  source.classList.remove('is-drop');
  const file = e.dataTransfer?.files?.[0];
  if (file) { e.preventDefault(); ingest(file); }
});
source.addEventListener('paste', (e) => {
  const cd = e.clipboardData;
  if (cd?.getData('text/plain')) return; // ordinary text paste
  const file = [...(cd?.files ?? [])][0];
  if (file) { e.preventDefault(); ingest(file); }
});

render();
