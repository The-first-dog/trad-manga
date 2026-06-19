// zipManager.js — Import / export ZIP avec JSZip (chargé globalement via <script>).

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/**
 * Extrait les images d'un fichier ZIP.
 * @param {File|Blob} zipFile
 * @returns {Promise<Array<{name: string, blob: Blob}>>}
 */
export async function extractImagesFromZip(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const entries = [];

  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    // Ignore les fichiers cachés / dossiers macOS.
    if (relativePath.startsWith('__MACOSX') || relativePath.split('/').pop().startsWith('.')) return;
    if (!IMAGE_EXT.test(relativePath)) return;
    entries.push({ path: relativePath, file });
  });

  // Tri naturel pour garder l'ordre des pages (1, 2, 10...).
  entries.sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })
  );

  const images = [];
  for (const { path, file } of entries) {
    const blob = await file.async('blob');
    images.push({ name: path.split('/').pop(), blob });
  }
  return images;
}

/**
 * Construit un ZIP à partir d'images traduites et déclenche le téléchargement.
 * @param {Array<{name: string, blob: Blob}>} images
 * @param {string} filename
 */
export async function buildZip(images, filename = 'manga-traduit.zip') {
  const zip = new JSZip();
  const used = new Set();

  for (const { name, blob } of images) {
    // Force l'extension .png (les rendus sont exportés en PNG) et évite les collisions.
    let base = name.replace(IMAGE_EXT, '');
    let outName = `${base}.png`;
    let i = 1;
    while (used.has(outName)) outName = `${base}-${i++}.png`;
    used.add(outName);
    zip.file(outName, blob);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  triggerDownload(content, filename);
}

/** Déclenche le téléchargement d'un Blob. */
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
