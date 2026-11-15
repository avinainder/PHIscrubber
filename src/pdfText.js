// Text extraction from report PDFs — pdf.js (vendored, all local). A 3mensio
// report is a PDF with an embedded TEXT layer: reading it directly gives the
// exact digits with zero OCR risk, so this is always preferred over
// screenshot OCR when the user has the file. Nothing leaves the browser.
//
// Layout handling: getTextContent() returns positioned runs, not lines. Runs
// are re-assembled into visual rows by clustering on their y position and
// sorting by x — which is exactly what puts a wrapped label ("Sinus of
// Valsalva" / "Diameter (mm)") and its distant value column back onto
// parser-friendly adjacent lines.

let pdfjsPromise = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc =
        new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return pdfjs;
    })().catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

/** Cluster positioned text runs into visual rows (y-descending in PDF space). */
function rowsFromItems(items) {
  const runs = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], h: it.height || 10 }));
  if (!runs.length) return '';
  const heights = runs.map((r) => r.h).sort((a, b) => a - b);
  const tol = Math.max(3, (heights[Math.floor(heights.length / 2)] || 10) * 0.6);
  const rows = [];
  for (const r of runs.sort((a, b) => b.y - a.y)) {
    const row = rows.find((q) => Math.abs(q.y - r.y) < tol);
    if (row) row.runs.push(r);
    else rows.push({ y: r.y, runs: [r] });
  }
  return rows
    .map((row) => row.runs.sort((a, b) => a.x - b.x).map((r) => r.str).join(' '))
    .join('\n');
}

/**
 * Extract row-clustered text from a PDF file/blob (first `maxPages` pages —
 * the 3mensio measurements live on page 1).
 */
export async function extractPdfText(blob, maxPages = 3) {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  const n = Math.min(doc.numPages, maxPages);
  const pages = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    pages.push(rowsFromItems((await page.getTextContent()).items));
  }
  await doc.destroy();
  return pages.join('\n\n');
}
