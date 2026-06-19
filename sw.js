// sw.js — Service Worker : cache du shell de l'app + cache d'exécution des
// bibliothèques et modèles (CDN, Hugging Face Hub) pour un fonctionnement
// hors-ligne après le premier chargement.

const VERSION = 'v1';
const SHELL_CACHE = `mangatrad-shell-${VERSION}`;
const RUNTIME_CACHE = `mangatrad-runtime-${VERSION}`;

// Fichiers locaux de l'application (shell).
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ocr.js',
  './translate.js',
  './imageProcessor.js',
  './zipManager.js',
];

// Installation : pré-cache du shell.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activation : nettoyage des anciens caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    // Shell : cache d'abord, réseau en repli (puis mise en cache).
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  } else {
    // Ressources externes (CDN libs, fichiers de langue Tesseract, modèles HF) :
    // cache d'abord pour le mode hors-ligne, sinon réseau + mise en cache.
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // On ne met en cache que les réponses exploitables.
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Hors-ligne et non mis en cache : on échoue proprement.
    const fallback = await cache.match(request);
    if (fallback) return fallback;
    throw err;
  }
}
