// Service Worker — offline cache for BAAC Field Route
// Strategy: NETWORK-FIRST for HTML/JS/CSS (always fresh), CACHE-FIRST for tiles/images

const CACHE_NAME = 'bfr-v2';  // bumped to invalidate old caches
const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/utils.js',
  '/js/auth.js',
  '/js/api.js',
  '/js/storage.js',
  '/js/customers.js',
  '/js/tsp.js',
  '/js/route.js',
  '/js/visit.js',
  '/js/app.js',
  '/manifest.json',
  '/version.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      // Delete ALL old caches (including bfr-v1)
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Network-first for app shell + version.json (always want fresh code)
  const isAppShell =
    url.origin === location.origin &&
    (url.pathname === '/' ||
     url.pathname === '/index.html' ||
     url.pathname.startsWith('/js/') ||
     url.pathname.startsWith('/css/') ||
     url.pathname === '/version.json' ||
     url.pathname === '/manifest.json' ||
     url.searchParams.has('_v'));   // cache-bust query string

  if (isAppShell) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Update cache with fresh copy
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // API: always network, never cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({error: 'offline'}), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  // Map tiles (unpkg, server.arcgisonline, tile.openstreetmap): cache-first
  if (url.host.includes('arcgisonline') ||
      url.host.includes('openstreetmap') ||
      url.host.includes('unpkg.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Default: try network, fallback to cache, then index.html
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
  );
});
