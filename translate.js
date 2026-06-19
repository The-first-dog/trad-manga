// translate.js — Traduction 100% locale avec Transformers.js (Helsinki-NLP / Opus-MT).
//
// Les modèles publics (Xenova/opus-mt-*) sont téléchargés depuis le Hugging Face
// Hub au premier usage, puis mis en cache par le navigateur (Cache Storage).
// Aucune API externe de traduction (pas de Google Translate, pas de clé).

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Pas de modèles locaux : on lit tout depuis le Hub. Cache navigateur activé.
env.allowLocalModels = false;
env.useBrowserCache = true;

// Un pipeline par paire de langues, gardé en mémoire pour la session.
const pipelines = new Map();

/**
 * Construit l'identifiant du modèle pour une paire de langues.
 * Pour changer de modèle, modifiez simplement cette fonction (voir README).
 */
export function modelIdFor(srcOpus, tgtOpus) {
  return `Xenova/opus-mt-${srcOpus}-${tgtOpus}`;
}

/**
 * Récupère (et met en cache) le pipeline de traduction pour une paire.
 * @param {function} onProgress  reçoit les évènements de téléchargement du modèle
 */
export async function getTranslator(srcOpus, tgtOpus, onProgress) {
  const id = modelIdFor(srcOpus, tgtOpus);
  if (pipelines.has(id)) return pipelines.get(id);

  const task = pipeline('translation', id, { progress_callback: onProgress });
  pipelines.set(id, task);
  try {
    return await task;
  } catch (err) {
    // En cas d'échec (paire inexistante par ex.), on retire l'entrée ratée.
    pipelines.delete(id);
    throw err;
  }
}

/**
 * Traduit un texte. Si source === cible, renvoie le texte tel quel.
 * @returns {Promise<string>}
 */
export async function translateText(srcOpus, tgtOpus, text, onProgress) {
  const clean = (text || '').trim();
  if (!clean) return '';
  if (srcOpus === tgtOpus) return clean;

  const translator = await getTranslator(srcOpus, tgtOpus, onProgress);
  const out = await translator(clean, { max_new_tokens: 512 });
  const result = Array.isArray(out) ? out[0] : out;
  return (result.translation_text || '').trim();
}

/**
 * Pré-charge le modèle d'une paire (utile pour afficher l'avancement avant
 * de lancer le traitement des images).
 */
export async function preloadModel(srcOpus, tgtOpus, onProgress) {
  if (srcOpus === tgtOpus) return;
  await getTranslator(srcOpus, tgtOpus, onProgress);
}
