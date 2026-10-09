const CACHE = 'hom-rpg-v33';
const ASSETS = ['/', '/app.js', '/core.js', '/game.js', '/devtools.js', '/framing.js', '/prompteditor.js', '/aitrace.js', '/northlife.js', '/chat.js', '/scenes.js', '/worldmap.js', '/textbox.js', '/actionbar.js', '/dialogs.js', '/settings.js', '/saves.js', '/mapview.js', '/maprender.js', '/shared/geo.js', '/shared/mapDefaults.js', '/shared/mapStyle.js', '/shared/mapTerrain.js', '/shared/mapGen.js', '/shared/polygonClipping.js', '/shared/stage.js','/base.css', '/umbral.css', '/mundo.css', '/objetos.css', '/desarrollo.css', '/fonts/inter-latin-wght-normal.woff2', '/fonts/spectral-latin-400-normal.woff2', '/fonts/spectral-latin-400-italic.woff2', '/manifest.json', '/favicon.svg', '/icon-192.png', '/assets/V%C3%B3rtice%20liminal.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
