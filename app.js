// app.js — Orchestration de l'application : UI, file de traitement, pipeline.
//
// Pipeline par image : OCR -> regroupement en blocs -> traduction -> rendu canvas.
// Tout est asynchrone (async/await) pour ne jamais bloquer l'interface.

import { runOCR, groupWords } from './ocr.js';
import { translateText, preloadModel } from './translate.js';
import { renderTranslated, canvasToBlob, makeThumb, loadImage } from './imageProcessor.js';
import { extractImagesFromZip, buildZip, triggerDownload } from './zipManager.js';

// ---------------------------------------------------------------------------
// Langues : code Tesseract (OCR) + code Opus-MT (traduction).
// Pour ajouter une langue : ajoutez une entrée ici (voir README).
// ---------------------------------------------------------------------------
const LANGS = [
  { label: 'Japonais',  tess: 'jpn',     opus: 'ja' },
  { label: 'Anglais',   tess: 'eng',     opus: 'en' },
  { label: 'Français',  tess: 'fra',     opus: 'fr' },
  { label: 'Espagnol',  tess: 'spa',     opus: 'es' },
  { label: 'Allemand',  tess: 'deu',     opus: 'de' },
  { label: 'Italien',   tess: 'ita',     opus: 'it' },
  { label: 'Chinois',   tess: 'chi_sim', opus: 'zh' },
  { label: 'Coréen',    tess: 'kor',     opus: 'ko' },
  { label: 'Russe',     tess: 'rus',     opus: 'ru' },
];

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------
let queue = [];          // [{ id, name, blob, status, progress, step, blocks, resultBlob, resultURL, thumbURL }]
let isProcessing = false;
let editingId = null;
let idSeq = 1;

// ---------------------------------------------------------------------------
// Raccourcis DOM
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const srcSelect = $('#srcLang');
const tgtSelect = $('#tgtLang');
const fileInput = $('#fileInput');
const fileDrop = $('#fileDrop');
const queueEl = $('#queue');
const queueCount = $('#queueCount');
const logsEl = $('#logs');
const engineStatus = $('#engineStatus');
const globalProgress = $('#globalProgress');
const globalProgressText = $('#globalProgressText');
const processBtn = $('#processBtn');
const clearBtn = $('#clearBtn');
const downloadZipBtn = $('#downloadZipBtn');

// ---------------------------------------------------------------------------
// Journalisation
// ---------------------------------------------------------------------------
function log(msg, level = 'info') {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('span');
  if (level !== 'info') line.className = level === 'error' ? 'err' : level === 'success' ? 'ok' : 'warn';
  line.textContent = `[${time}] ${msg}\n`;
  logsEl.appendChild(line);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function setEngineStatus(text, cls = '') {
  engineStatus.textContent = text;
  engineStatus.className = `status-pill ${cls}`;
}

// ---------------------------------------------------------------------------
// Initialisation de l'UI
// ---------------------------------------------------------------------------
function initLangSelectors() {
  for (const lang of LANGS) {
    srcSelect.add(new Option(lang.label, lang.opus));
    tgtSelect.add(new Option(lang.label, lang.opus));
  }
  srcSelect.value = 'ja';
  tgtSelect.value = 'fr';
}

function langByOpus(opus) {
  return LANGS.find((l) => l.opus === opus);
}

// ---------------------------------------------------------------------------
// Gestion de la file (rendu)
// ---------------------------------------------------------------------------
function renderQueue() {
  queueCount.textContent = `${queue.length} image(s)`;
  processBtn.disabled = queue.length === 0 || isProcessing;

  const hasResults = queue.some((it) => it.resultBlob);
  downloadZipBtn.disabled = !hasResults || isProcessing;

  if (queue.length === 0) {
    queueEl.innerHTML = '<p class="empty-hint">Aucune image. Importez une image ou un ZIP pour commencer.</p>';
    return;
  }

  queueEl.innerHTML = '';
  for (const item of queue) {
    queueEl.appendChild(renderCard(item));
  }
}

function renderCard(item) {
  const card = document.createElement('div');
  card.className = 'card';

  const badgeClass = { queued: 'queued', working: 'working', done: 'done', error: 'error' }[item.status];
  const badgeText = { queued: 'En attente', working: 'En cours', done: 'Terminé', error: 'Erreur' }[item.status];

  card.innerHTML = `
    <div class="card-top">
      <div style="flex:1">
        <div class="card-name">${escapeHtml(item.name)}</div>
        <div class="card-meta">${item.blocks ? item.blocks.length + ' bloc(s) détecté(s)' : '—'}</div>
      </div>
      <span class="badge ${badgeClass}">${badgeText}</span>
    </div>
    <div class="card-progress">
      <div class="step">${escapeHtml(item.step || '')}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.round((item.progress || 0) * 100)}%"></div></div>
    </div>
    <div class="previews">
      <div class="preview">
        <div class="cap">Avant</div>
        ${item.thumbURL ? `<img src="${item.thumbURL}" alt="avant" />` : ''}
      </div>
      <div class="preview">
        <div class="cap">Après</div>
        ${item.resultURL ? `<img src="${item.resultURL}" alt="après" />` : ''}
      </div>
    </div>
    <div class="card-actions"></div>
  `;

  const actions = card.querySelector('.card-actions');
  if (item.resultBlob) {
    const editBtn = button('Éditer la traduction', 'ghost small', () => openEditModal(item.id));
    const dlBtn = button('Télécharger', 'small', () =>
      triggerDownload(item.resultBlob, item.name.replace(/\.[^.]+$/, '') + '.png')
    );
    actions.append(editBtn, dlBtn);
  }
  return card;
}

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function updateGlobalProgress() {
  if (queue.length === 0) {
    globalProgress.style.width = '0%';
    globalProgressText.textContent = '0 %';
    return;
  }
  const total = queue.reduce((sum, it) => sum + (it.progress || 0), 0);
  const pct = Math.round((total / queue.length) * 100);
  globalProgress.style.width = pct + '%';
  globalProgressText.textContent = pct + ' %';
}

// Met à jour un item sans tout reconstruire (fluidité).
function updateItem(item, patch) {
  Object.assign(item, patch);
  renderQueue();
  updateGlobalProgress();
}

// ---------------------------------------------------------------------------
// Import de fichiers
// ---------------------------------------------------------------------------
async function handleFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  for (const file of files) {
    try {
      if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
        log(`Lecture du ZIP « ${file.name} »...`);
        const images = await extractImagesFromZip(file);
        if (images.length === 0) log(`Aucune image trouvée dans « ${file.name} ».`, 'warn');
        for (const img of images) await addToQueue(img.name, img.blob);
        log(`${images.length} image(s) ajoutée(s) depuis le ZIP.`, 'success');
      } else if (/\.(png|jpe?g|webp)$/i.test(file.name) || /^image\//.test(file.type)) {
        await addToQueue(file.name, file);
      } else {
        log(`Type non supporté ignoré : ${file.name}`, 'warn');
      }
    } catch (err) {
      log(`Erreur à l'import de « ${file.name} » : ${err.message}`, 'error');
    }
  }
  renderQueue();
}

async function addToQueue(name, blob) {
  const item = {
    id: idSeq++,
    name,
    blob,
    status: 'queued',
    progress: 0,
    step: '',
    blocks: null,
    resultBlob: null,
    resultURL: null,
    thumbURL: null,
  };
  queue.push(item);
  renderQueue();
  // Miniature "avant" en arrière-plan.
  try {
    item.thumbURL = await makeThumb(blob);
    renderQueue();
  } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Pipeline de traitement
// ---------------------------------------------------------------------------
async function processAll() {
  if (isProcessing) return;
  const src = srcSelect.value;
  const tgt = tgtSelect.value;
  const srcLang = langByOpus(src);

  isProcessing = true;
  renderQueue();
  setEngineStatus('Moteurs : chargement...', 'busy');

  // Pré-chargement du modèle de traduction (affiche l'avancement du téléchargement).
  if (src !== tgt) {
    try {
      log(`Préparation du modèle de traduction ${src} → ${tgt}...`);
      await preloadModel(src, tgt, (p) => {
        if (p && p.status === 'progress' && p.file) {
          setEngineStatus(`Modèle ${Math.round(p.progress || 0)}% (${p.file})`, 'busy');
        }
      });
      log('Modèle de traduction prêt.', 'success');
    } catch (err) {
      log(`Impossible de charger le modèle ${src} → ${tgt} : ${err.message}`, 'error');
      log(`La paire « opus-mt-${src}-${tgt} » n'existe peut-être pas. Voir le README.`, 'warn');
      isProcessing = false;
      setEngineStatus('Moteurs : erreur', '');
      renderQueue();
      return;
    }
  }

  setEngineStatus('Moteurs : traitement', 'busy');

  for (const item of queue) {
    if (item.status === 'done') continue; // déjà fait
    try {
      await processItem(item, src, tgt, srcLang.tess);
    } catch (err) {
      updateItem(item, { status: 'error', step: 'Erreur', progress: item.progress });
      log(`« ${item.name} » : ${err.message}`, 'error');
    }
  }

  isProcessing = false;
  setEngineStatus('Moteurs : prêts', 'ready');
  updateGlobalProgress();
  renderQueue();
  log('Traitement de la file terminé.', 'success');
}

async function processItem(item, src, tgt, tessLang) {
  updateItem(item, { status: 'working', step: 'OCR en cours...', progress: 0.02 });

  // 1) OCR (la progression OCR couvre 0 -> 40%)
  const { words } = await runOCR(item.blob, tessLang, (p) => {
    updateItem(item, { progress: 0.4 * p, step: `OCR ${Math.round(p * 100)}%` });
  });

  // 2) Regroupement en blocs
  const blocks = groupWords(words);
  updateItem(item, { blocks, step: `${blocks.length} bloc(s) — traduction...`, progress: 0.42 });

  if (blocks.length === 0) {
    log(`« ${item.name} » : aucun texte détecté.`, 'warn');
  }

  // 3) Traduction bloc par bloc (40% -> 85%)
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    b.translated = await translateText(src, tgt, b.text);
    const p = 0.42 + 0.43 * ((i + 1) / Math.max(1, blocks.length));
    updateItem(item, { progress: p, step: `Traduction ${i + 1}/${blocks.length}` });
  }

  // 4) Rendu canvas (85% -> 100%)
  updateItem(item, { step: 'Composition de l\'image...', progress: 0.9 });
  const canvas = await renderTranslated(item.blob, blocks);
  const resultBlob = await canvasToBlob(canvas, 'image/png');
  if (item.resultURL) URL.revokeObjectURL(item.resultURL);

  updateItem(item, {
    status: 'done',
    step: 'Terminé',
    progress: 1,
    resultBlob,
    resultURL: URL.createObjectURL(resultBlob),
  });
  log(`« ${item.name} » traduit (${blocks.length} bloc(s)).`, 'success');

  // Laisse respirer l'UI entre deux images.
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Édition manuelle des traductions
// ---------------------------------------------------------------------------
function openEditModal(id) {
  const item = queue.find((it) => it.id === id);
  if (!item || !item.blocks) return;
  editingId = id;

  const container = $('#editBlocks');
  container.innerHTML = '';
  if (item.blocks.length === 0) {
    container.innerHTML = '<p class="empty-hint">Aucun bloc de texte détecté sur cette image.</p>';
  }
  item.blocks.forEach((b, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'edit-block';
    wrap.innerHTML = `
      <label>Bloc ${i + 1}</label>
      <div class="orig">Original : ${escapeHtml(b.text || '—')}</div>
    `;
    const ta = document.createElement('textarea');
    ta.value = b.translated || '';
    ta.dataset.index = String(i);
    wrap.appendChild(ta);
    container.appendChild(wrap);
  });

  $('#editModal').hidden = false;
}

function closeEditModal() {
  $('#editModal').hidden = true;
  editingId = null;
}

async function applyEdits() {
  const item = queue.find((it) => it.id === editingId);
  if (!item) return closeEditModal();

  const textareas = $('#editBlocks').querySelectorAll('textarea');
  textareas.forEach((ta) => {
    const idx = Number(ta.dataset.index);
    if (item.blocks[idx]) item.blocks[idx].translated = ta.value;
  });

  closeEditModal();
  updateItem(item, { step: 'Régénération...', status: 'working', progress: 0.9 });
  try {
    const canvas = await renderTranslated(item.blob, item.blocks);
    const resultBlob = await canvasToBlob(canvas, 'image/png');
    if (item.resultURL) URL.revokeObjectURL(item.resultURL);
    updateItem(item, {
      status: 'done',
      step: 'Terminé',
      progress: 1,
      resultBlob,
      resultURL: URL.createObjectURL(resultBlob),
    });
    log(`« ${item.name} » régénéré après édition manuelle.`, 'success');
  } catch (err) {
    updateItem(item, { status: 'error', step: 'Erreur' });
    log(`Échec de la régénération : ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Export ZIP global
// ---------------------------------------------------------------------------
async function downloadAllZip() {
  const done = queue.filter((it) => it.resultBlob);
  if (done.length === 0) return;
  log(`Création du ZIP de ${done.length} image(s)...`);
  try {
    await buildZip(done.map((it) => ({ name: it.name, blob: it.resultBlob })));
    log('ZIP téléchargé.', 'success');
  } catch (err) {
    log(`Erreur ZIP : ${err.message}`, 'error');
  }
}

function clearQueue() {
  if (isProcessing) return;
  queue.forEach((it) => it.resultURL && URL.revokeObjectURL(it.resultURL));
  queue = [];
  renderQueue();
  updateGlobalProgress();
  log('File vidée.');
}

// ---------------------------------------------------------------------------
// Évènements
// ---------------------------------------------------------------------------
function wireEvents() {
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });

  // Glisser-déposer
  ['dragenter', 'dragover'].forEach((ev) =>
    fileDrop.addEventListener(ev, (e) => { e.preventDefault(); fileDrop.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    fileDrop.addEventListener(ev, (e) => { e.preventDefault(); fileDrop.classList.remove('drag'); })
  );
  fileDrop.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
  });

  processBtn.addEventListener('click', processAll);
  clearBtn.addEventListener('click', clearQueue);
  downloadZipBtn.addEventListener('click', downloadAllZip);

  $('#closeEditBtn').addEventListener('click', closeEditModal);
  $('#reRenderBtn').addEventListener('click', applyEdits);
  $('#editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') closeEditModal();
  });
  $('#clearLogsBtn').addEventListener('click', () => { logsEl.textContent = ''; });
}

// ---------------------------------------------------------------------------
// Service Worker (cache hors-ligne)
// ---------------------------------------------------------------------------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(() => log('Service Worker enregistré (cache hors-ligne actif).'))
      .catch((err) => log(`Service Worker non enregistré : ${err.message}`, 'warn'));
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
function boot() {
  initLangSelectors();
  wireEvents();
  registerServiceWorker();
  renderQueue();
  setEngineStatus('Moteurs : prêts', 'ready');
  log('Application prête. Importez une image ou un ZIP.');
  log('Astuce : le premier traitement télécharge les modèles (OCR + traduction), patientez.');
}

boot();
