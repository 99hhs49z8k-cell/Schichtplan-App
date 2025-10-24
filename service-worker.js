
// service-worker.js
const CACHE = 'schichtplan-v4';
const ASSETS = [
  './',
  './index.html?v=4',
  './app.js?v=4',
  './manifest.json?v=4',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  // Dateien cachen und SW sofort in "waiting" bringen
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  // alte Caches löschen + sofort Kontrolle übernehmen
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});

// ===== Neu: Update-Mechanismus =====
// App kann dem SW sagen, dass er sofort aktiv werden soll
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
