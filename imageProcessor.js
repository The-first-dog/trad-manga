// imageProcessor.js — Manipulation des images via Canvas.
//
// - efface le texte d'origine (rectangle arrondi rempli de la couleur moyenne
//   environnante, légèrement flouté sur les bords)
// - réécrit le texte traduit dans la même zone : taille de police adaptée,
//   retour à la ligne automatique, centrage horizontal + vertical.

const FONT_FAMILY = '"Comic Sans MS", "Segoe UI", system-ui, sans-serif';

/** Charge une source d'image (Blob / dataURL / URL) en HTMLImageElement. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    if (src instanceof Blob) {
      img.src = URL.createObjectURL(src);
    } else {
      img.src = src;
    }
  });
}

/** Tracé d'un rectangle à coins arrondis. */
function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Calcule la couleur moyenne d'un anneau autour de la zone (sans inclure le
 * texte lui-même), pour choisir une couleur de fond cohérente avec la bulle.
 */
function averageSurroundingColor(ctx, bbox) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const pad = Math.max(6, Math.round(Math.min(bbox.w, bbox.h) * 0.25));

  const ox = Math.max(0, Math.round(bbox.x - pad));
  const oy = Math.max(0, Math.round(bbox.y - pad));
  const ox2 = Math.min(cw, Math.round(bbox.x + bbox.w + pad));
  const oy2 = Math.min(ch, Math.round(bbox.y + bbox.h + pad));
  const ow = ox2 - ox, oh = oy2 - oy;
  if (ow <= 0 || oh <= 0) return 'rgb(255,255,255)';

  const { data } = ctx.getImageData(ox, oy, ow, oh);

  // Zone intérieure (texte) à exclure, en coordonnées locales.
  const ix = bbox.x - ox, iy = bbox.y - oy;
  const ix2 = ix + bbox.w, iy2 = iy + bbox.h;

  let r = 0, g = 0, b = 0, n = 0;
  for (let py = 0; py < oh; py++) {
    for (let px = 0; px < ow; px++) {
      if (px >= ix && px < ix2 && py >= iy && py < iy2) continue; // saute l'intérieur
      const i = (py * ow + px) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  if (n === 0) return 'rgb(255,255,255)';
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

/** Efface la zone d'origine avec un rectangle arrondi couleur de fond + bords adoucis. */
function eraseRegion(ctx, bbox) {
  const color = averageSurroundingColor(ctx, bbox);
  const r = Math.min(bbox.w, bbox.h) * 0.25;

  ctx.save();
  // Le shadow de la même couleur adoucit légèrement les bords (effet flou léger).
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(4, Math.round(Math.min(bbox.w, bbox.h) * 0.12));
  ctx.fillStyle = color;
  roundRectPath(ctx, bbox.x, bbox.y, bbox.w, bbox.h, r);
  ctx.fill();
  // Second passage net pour assurer une couverture pleine au centre.
  ctx.shadowBlur = 0;
  ctx.fill();
  ctx.restore();

  return color;
}

/** Découpe un texte en lignes pour une largeur max (par mots, ou par caractères pour le CJK). */
function wrapText(ctx, text, maxWidth, fontSize) {
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const hasSpaces = /\s/.test(text.trim());
  const tokens = hasSpaces ? text.trim().split(/\s+/) : Array.from(text.trim());
  const sep = hasSpaces ? ' ' : '';

  const lines = [];
  let line = '';
  for (const tok of tokens) {
    const test = line ? line + sep + tok : tok;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = tok;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Cherche la plus grande taille de police pour laquelle le texte rentre dans la boîte. */
function fitText(ctx, text, boxW, boxH) {
  const padW = boxW * 0.9;
  const padH = boxH * 0.92;
  let best = { size: 8, lines: wrapText(ctx, text, padW, 8), lineHeight: 8 * 1.18 };

  const start = Math.min(Math.floor(boxH), 64);
  for (let size = start; size >= 8; size--) {
    const lines = wrapText(ctx, text, padW, size);
    const lineHeight = size * 1.18;
    const totalH = lines.length * lineHeight;
    ctx.font = `${size}px ${FONT_FAMILY}`;
    const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (totalH <= padH && maxLineW <= padW) {
      return { size, lines, lineHeight };
    }
  }
  return best;
}

/** Dessine le texte traduit centré dans la boîte. */
function drawText(ctx, bbox, text) {
  if (!text || !text.trim()) return;
  const { size, lines, lineHeight } = fitText(ctx, text, bbox.w, bbox.h);

  ctx.save();
  ctx.font = `${size}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111111';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(1, size * 0.12);
  ctx.lineJoin = 'round';

  const cx = bbox.x + bbox.w / 2;
  const totalH = lines.length * lineHeight;
  let y = bbox.y + bbox.h / 2 - totalH / 2 + lineHeight / 2;

  for (const line of lines) {
    ctx.strokeText(line, cx, y); // contour clair pour la lisibilité
    ctx.fillText(line, cx, y);
    y += lineHeight;
  }
  ctx.restore();
}

/**
 * Rend l'image traduite sur un canvas.
 * @param {*} imageSource  Blob / dataURL / Image
 * @param {Array} blocks   [{ bbox, translated }]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderTranslated(imageSource, blocks) {
  const img = await loadImage(imageSource);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  for (const block of blocks) {
    if (!block || !block.bbox) continue;
    eraseRegion(ctx, block.bbox);
    drawText(ctx, block.bbox, block.translated);
  }
  return canvas;
}

/** Convertit un canvas en Blob PNG. */
export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Génère une miniature dataURL (pour l'aperçu "avant"). */
export async function makeThumb(imageSource, maxSide = 480) {
  const img = await loadImage(imageSource);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}
