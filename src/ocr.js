// In-browser OCR for report screenshots — tesseract.js, fully vendored: the
// worker, the wasm core, and the English model all load from this origin
// (vendor/tesseract/) and the image never leaves the browser. No CDN, no
// upload — a screenshot with patient identifiers on it stays in page memory
// and is gone on reload. Loaded lazily: none of the ~6 MB is fetched until
// the first screenshot is scanned.

let workerPromise = null;
let currentProgress = null;

const asset = (name) => new URL(`../vendor/tesseract/${name}`, import.meta.url).href;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // The vendored ESM build exposes the library as its default export
      const mod = await import('../vendor/tesseract/tesseract.esm.min.js');
      const createWorker = mod.createWorker ?? mod.default?.createWorker;
      const worker = await createWorker('eng', 1, {
        workerPath: asset('worker.min.js'),
        corePath: asset('tesseract-core-simd-lstm.wasm.js'),
        langPath: new URL('../vendor/tesseract', import.meta.url).href,
        gzip: true,
        logger: (m) => currentProgress?.(m),
      });
      return worker;
    })().catch((err) => {
      workerPromise = null; // a failed load may retry (e.g. flaky reload)
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Flatten (and upscale small captures) before OCR. EVERY image goes through
 * the canvas: source screenshots can carry DPI metadata (e.g. 2x Retina
 * captures embed 192 dpi) that derails tesseract's layout analysis into
 * cell-by-cell garbage — re-encoding resets that, flattens alpha onto white,
 * and drops color noise via grayscale. Small 1x captures with ~12 px table
 * text are additionally scaled up toward ~2200 px wide, the size where the
 * digits read reliably.
 */
async function preprocess(blob, targetW = 2200, deunderline = false) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(6, Math.max(1, Math.round(targetW / bmp.width)));
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width * scale;
  canvas.height = bmp.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'grayscale(1)';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  if (deunderline) eraseUnderlines(ctx, canvas.width, canvas.height, scale);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

/**
 * White out long, thin horizontal dark runs — underlines and table rules.
 * Report values printed ON an underline fuse with it and the whole row dies
 * in recognition; with the line gone the digits read. A run only qualifies
 * when the pixels a few rows above AND below are light, so the horizontal
 * strokes inside glyphs (E, =, table text) survive. Thick (scaled) lines
 * erode row by row as the scan revisits them.
 */
function eraseUnderlines(ctx, w, h, scale) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const dark = (x, y) => d[(y * w + x) * 4] < 140;
  const minLen = Math.max(24, Math.round(w * 0.02));
  const maxThick = 3 * scale; // a 1px source line after upscale + smoothing blur
  for (let y = 1; y < h - 1; y++) {
    let x = 0;
    while (x < w) {
      if (!dark(x, y)) { x++; continue; }
      let x1 = x;
      while (x1 < w && dark(x1, y)) x1++;
      if (x1 - x >= minLen) {
        // Is this run a line (most columns vertically thin) or a stripe
        // through dense text? Only lines get erased.
        let thin = 0;
        for (let xx = x; xx < x1; xx++) {
          let up = 0, down = 0;
          while (up <= maxThick && y - up - 1 >= 0 && dark(xx, y - up - 1)) up++;
          while (down <= maxThick && y + down + 1 < h && dark(xx, y + down + 1)) down++;
          if (up + down + 1 <= maxThick) thin++;
        }
        if (thin >= (x1 - x) * 0.5) {
          // Erase the WHOLE band across the run — including where digit
          // strokes cross it. Digits fused to the line lose ~2px of their
          // bottoms, which recognition tolerates; selectively keeping the
          // crossing columns instead leaves ragged residue that shreds the
          // glyphs entirely. Thicker lines erode as later rows re-match.
          // Asymmetric margin: generous below (nothing lives under an
          // underline), minimal above — a decimal point sits right on top
          // of the line and dies with a wider upward cut.
          for (let xx = x; xx < x1; xx++) {
            for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 2); yy++) {
              const i = (yy * w + xx) * 4;
              d[i] = d[i + 1] = d[i + 2] = 255;
            }
          }
        }
      }
      x = x1;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Rebuild visual rows from word bounding boxes: cluster by y, sort by x.
 * Sparse recognition finds words that block segmentation drops on hostile
 * layouts (borderless tables, wide label→value gutters), but emits them in
 * an arbitrary order — clustering restores parser-friendly lines. */
function rowClusterWords(blocks) {
  const words = (blocks ?? [])
    .flatMap((b) => (b.paragraphs ?? []).flatMap((p) => (p.lines ?? []).flatMap((l) => l.words ?? [])))
    .filter((w) => w.text?.trim() && w.bbox);
  if (!words.length) return '';
  const hs = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 10;
  const rows = [];
  for (const w of words.sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1))) {
    const yc = (w.bbox.y0 + w.bbox.y1) / 2;
    const row = rows.find((r) => Math.abs(r.yc - yc) < medH * 0.6);
    if (row) row.words.push(w);
    else rows.push({ yc, words: [w] });
  }
  return rows
    .map((r) => r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map((w) => w.text).join(' '))
    .join('\n');
}

/**
 * Recognize the text in an image Blob/File. onProgress receives
 * {status, progress} updates ("recognizing text", 0–1).
 * psm: tesseract page-segmentation mode ('3' full auto — the library's
 * PSM 6 default shreds bordered tables; '11' sparse for hostile layouts).
 * cluster: rebuild lines from word boxes instead of trusting block order.
 */
export async function recognizeImage(blob, onProgress, { targetW = 2200, psm = '3', cluster = false, deunderline = false } = {}) {
  currentProgress = onProgress ?? null;
  try {
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const prepared = await preprocess(blob, targetW, deunderline).catch(() => blob);
    const { data } = await worker.recognize(prepared, {}, { text: true, blocks: cluster });
    if (cluster) {
      const rows = rowClusterWords(data?.blocks);
      if (rows) return rows;
    }
    return data?.text ?? '';
  } finally {
    currentProgress = null;
  }
}
