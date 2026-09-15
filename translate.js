// translate.js — Traduction 100% locale avec Transformers.js (Helsinki-NLP / Opus-MT).
//
// Les modèles publics (Xenova/opus-mt-*) sont téléchargés depuis le Hugging Face
// Hub au premier usage, puis mis en cache par le navigateur (Cache Storage).
// Aucune API externe de traduction (pas de Google Translate, pas de clé).
//
// Trois stratégies, dans l'ordre :
//   1. Modèle personnalisé (identifiant HF fourni par l'utilisateur) — remplace tout.
//   2. Modèle direct de la paire : Xenova/opus-mt-<src>-<tgt>.
//   3. Repli « pivot » par l'anglais : <src>→en puis en→<tgt>, quand la paire
//      directe n'existe pas (cas très fréquent, ex. ja→fr).

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Pas de modèles locaux : on lit tout depuis le Hub. Cache navigateur activé.
env.allowLocalModels = false;
env.useBrowserCache = true;

// Un pipeline par identifiant de modèle, gardé en mémoire pour la session.
const pipelines = new Map();

// Modèle personnalisé optionnel (identifiant Hugging Face). Null = automatique.
let customModelId = null;

// Mémorise, pour chaque paire, si le modèle direct a échoué (→ pivot direct).
const directFailed = new Set();

/**
 * Définit (ou efface) un modèle de traduction personnalisé.
 * @param {string|null} id  ex. "Xenova/opus-mt-ja-en". Vide/null = automatique.
 */
export function setCustomModel(id) {
  const trimmed = (id || '').trim();
  customModelId = trimmed.length ? trimmed : null;
}

/** Identifiant du modèle par défaut pour une paire de langues. */
export function modelIdFor(srcOpus, tgtOpus) {
  return `Xenova/opus-mt-${srcOpus}-${tgtOpus}`;
}

/** Charge (et met en cache) un pipeline de traduction pour un identifiant de modèle. */
async function loadPipeline(modelId, onProgress) {
  if (pipelines.has(modelId)) return pipelines.get(modelId);

  const task = pipeline('translation', modelId, { progress_callback: onProgress });
  pipelines.set(modelId, task);
  try {
    return await task;
  } catch (err) {
    // Échec (modèle inexistant, réseau…) : on retire l'entrée ratée.
    pipelines.delete(modelId);
    throw err;
  }
}

/** Exécute la traduction d'un texte via un pipeline chargé. */
async function runPipeline(translator, text) {
  const out = await translator(text, { max_new_tokens: 512 });
  const result = Array.isArray(out) ? out[0] : out;
  return (result.translation_text || '').trim();
}

/**
 * Traduit un texte. Si source === cible, renvoie le texte tel quel.
 * @returns {Promise<string>}
 */
export async function translateText(srcOpus, tgtOpus, text, onProgress) {
  const clean = (text || '').trim();
  if (!clean) return '';

  // 1) Modèle personnalisé : il gère la paire quelle qu'elle soit.
  if (customModelId) {
    const translator = await loadPipeline(customModelId, onProgress);
    return runPipeline(translator, clean);
  }

  if (srcOpus === tgtOpus) return clean;

  const pairKey = `${srcOpus}-${tgtOpus}`;
  const canPivot = srcOpus !== 'en' && tgtOpus !== 'en';

  // 2) Modèle direct (sauf s'il a déjà échoué durant la session).
  if (!directFailed.has(pairKey)) {
    try {
      const translator = await loadPipeline(modelIdFor(srcOpus, tgtOpus), onProgress);
      return runPipeline(translator, clean);
    } catch (err) {
      if (!canPivot) throw err;
      directFailed.add(pairKey); // on ne réessaiera plus le direct pour cette paire
    }
  }

  // 3) Pivot par l'anglais : src → en → tgt.
  const toEn = await loadPipeline(modelIdFor(srcOpus, 'en'), onProgress);
  const english = await runPipeline(toEn, clean);
  const fromEn = await loadPipeline(modelIdFor('en', tgtOpus), onProgress);
  return runPipeline(fromEn, english);
}

/**
 * Pré-charge le(s) modèle(s) d'une paire (affiche l'avancement du téléchargement
 * avant de lancer le traitement des images). Reproduit la même stratégie que
 * translateText, pivot compris, pour que l'erreur remonte tôt si rien n'existe.
 */
export async function preloadModel(srcOpus, tgtOpus, onProgress) {
  if (customModelId) {
    await loadPipeline(customModelId, onProgress);
    return;
  }
  if (srcOpus === tgtOpus) return;

  const pairKey = `${srcOpus}-${tgtOpus}`;
  const canPivot = srcOpus !== 'en' && tgtOpus !== 'en';

  if (!directFailed.has(pairKey)) {
    try {
      await loadPipeline(modelIdFor(srcOpus, tgtOpus), onProgress);
      return;
    } catch (err) {
      if (!canPivot) throw err;
      directFailed.add(pairKey);
    }
  }

  await loadPipeline(modelIdFor(srcOpus, 'en'), onProgress);
  await loadPipeline(modelIdFor('en', tgtOpus), onProgress);
}
