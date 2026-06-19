// ocr.js — OCR local avec Tesseract.js (chargé globalement via <script> dans index.html)
//
// Expose deux fonctions :
//   runOCR(image, tessLang, onProgress) -> { words, raw }
//   groupWords(words, options)          -> [ { bbox, text, words } ]
//
// Aucune donnée ne quitte le navigateur : Tesseract télécharge ses fichiers de
// langue (depuis le CDN jsdelivr) au premier usage, puis ils sont mis en cache.

// On réutilise un worker par langue pour éviter de tout recharger à chaque image.
const workers = new Map();
let progressHook = null; // callback de progression courant (0..1)

async function getWorker(tessLang) {
  if (workers.has(tessLang)) return workers.get(tessLang);

  // Tesseract est exposé globalement par le <script> du CDN.
  const worker = await Tesseract.createWorker(tessLang, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && progressHook) {
        progressHook(m.progress);
      }
    },
  });
  workers.set(tessLang, worker);
  return worker;
}

/**
 * Lance l'OCR sur une image (Blob, dataURL, HTMLImageElement, Canvas...).
 * @returns {Promise<{words: Array, raw: object}>}
 */
export async function runOCR(image, tessLang, onProgress) {
  progressHook = onProgress || null;
  const worker = await getWorker(tessLang);
  const { data } = await worker.recognize(image);
  progressHook = null;

  // Normalise les mots : { text, conf, bbox:{x,y,w,h} }
  const words = (data.words || [])
    .filter((w) => w.text && w.text.trim().length > 0)
    .map((w) => ({
      text: w.text.trim(),
      conf: w.confidence,
      bbox: {
        x: w.bbox.x0,
        y: w.bbox.y0,
        w: w.bbox.x1 - w.bbox.x0,
        h: w.bbox.y1 - w.bbox.y0,
      },
    }));

  return { words, raw: data };
}

/** Libère les workers (rarement utile, mais propre). */
export async function terminateOCR() {
  for (const w of workers.values()) {
    try { await w.terminate(); } catch (_) { /* ignore */ }
  }
  workers.clear();
}

// ---------------------------------------------------------------------------
// Regroupement des mots proches en blocs de texte (≈ bulles).
// ---------------------------------------------------------------------------

function boxesClose(a, b, gapX, gapY) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(ax2, bx2));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(ay2, by2));
  return dx <= gapX && dy <= gapY;
}

function mergeBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * Regroupe les mots dont les boîtes sont proches.
 * @param {Array} words  liste issue de runOCR
 * @param {object} opts  { minConf }
 * @returns {Array} blocs : { bbox, text, words }
 */
export function groupWords(words, opts = {}) {
  const minConf = opts.minConf ?? 35;
  const valid = words.filter((w) => w.conf >= minConf);
  if (valid.length === 0) return [];

  // Hauteur médiane des mots : sert d'échelle pour les seuils de proximité.
  const heights = valid.map((w) => w.bbox.h).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] || 16;
  const gapX = medH * 1.4; // mots espacés horizontalement = même ligne/bloc
  const gapY = medH * 0.9; // lignes empilées = même bloc

  // Chaque mot démarre dans son propre cluster.
  let clusters = valid.map((w) => ({ bbox: { ...w.bbox }, words: [w] }));

  // Fusion itérative jusqu'à stabilité.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (boxesClose(clusters[i].bbox, clusters[j].bbox, gapX, gapY)) {
          clusters[i].bbox = mergeBox(clusters[i].bbox, clusters[j].bbox);
          clusters[i].words.push(...clusters[j].words);
          clusters.splice(j, 1);
          changed = true;
          j--;
        }
      }
    }
  }

  // Reconstruit le texte de chaque bloc en ordre de lecture (haut -> bas, gauche -> droite).
  return clusters
    .filter((c) => c.words.length > 0)
    .map((c) => {
      const sorted = [...c.words].sort((a, b) => {
        const lineDelta = a.bbox.y - b.bbox.y;
        if (Math.abs(lineDelta) > medH * 0.6) return lineDelta;
        return a.bbox.x - b.bbox.x;
      });
      const text = sorted.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
      // Petite marge autour du bloc pour bien recouvrir le texte original.
      const pad = Math.round(medH * 0.25);
      const bbox = {
        x: Math.max(0, c.bbox.x - pad),
        y: Math.max(0, c.bbox.y - pad),
        w: c.bbox.w + pad * 2,
        h: c.bbox.h + pad * 2,
      };
      return { bbox, text, words: sorted };
    })
    .filter((b) => b.text.length > 0);
}
