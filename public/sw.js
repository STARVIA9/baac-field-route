// Service Worker — offline cache for BAAC Field Route
// Strategy: NETWORK-FIRST for HTML/JS/CSS (always fresh), CACHE-FIRST for tiles/images
// Enhanced: Full offline support for field work

const CACHE_NAME = "bfr-v20260917e";
const STATIC_CACHE = "bfr-static-v20260828a";
const TILE_CACHE = "bfr-tiles-v20260828a";

const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/vendor.js',
  '/js/app.bundle.js',
  '/js/admin-customers.js',
  '/admin.html',
  '/css/admin.css',
  '/manifest.json',
  '/version.json',
];

// Install — cache static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Listen for skip waiting message
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch handler
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
     url.searchParams.has('_v'));

  if (isAppShell) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Update cache with fresh copy
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // API: always network, never cache (but return offline response if failed)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Cache successful GET requests for offline fallback
          if (e.request.method === 'GET' && res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          // Try to return cached response for GET requests
          if (e.request.method === 'GET') {
            return caches.match(e.request).then(cached => {
              if (cached) return cached;
              // Return offline response
              return new Response(JSON.stringify({
                error: 'offline',
                message: 'ไม่มีอินเทอร์เน็ต — ใช้ข้อมูลในเครื่อง'
              }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              });
            });
          }
          // For POST/PUT/DELETE, return error
          return new Response(JSON.stringify({
            error: 'offline',
            message: 'ไม่มีอินเทอร์เน็ต — กรุณาลองใหม่เมื่อมีเน็ต'
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // Map tiles (unpkg, server.arcgisonline, tile.openstreetmap): cache-first with size limit
  if (url.host.includes('arcgisonline') ||
      url.host.includes('openstreetmap') ||
      url.host.includes('unpkg.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(TILE_CACHE).then(async (c) => {
            await c.put(e.request, clone);
            // Evict oldest tiles if cache exceeds 500 entries
            const keys = await c.keys();
            if (keys.length > 500) {
              // Remove oldest 100 entries
              for (let i = 0; i < 100 && i < keys.length; i++) {
                await c.delete(keys[i]);
              }
            }
          });
          return res;
        });
      })
    );
    return;
  }

  // Static assets (JSON data files): cache-first
  if (url.pathname.endsWith('.json') && url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        // Return cached first, then update in background
        const fetchPromise = fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
          return res;
        }).catch(() => cached);
        
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Default: try network, fallback to cache, then index.html
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful responses
        if (res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-customers') {
    event.waitUntil(syncCustomers());
  } else if (event.tag === 'sync-visits') {
    event.waitUntil(syncVisits());
  }
});

// Sync customers from IndexedDB/localStorage to server
async function syncCustomers() {
  try {
    const clients = await self.clients.matchAll();
    // Notify client to sync
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_CUSTOMERS' });
    });
  } catch (err) {
    console.error('[SW] Sync customers failed:', err);
  }
}

// Sync visits from IndexedDB/localStorage to server
async function syncVisits() {
  try {
    const clients = await self.clients.matchAll();
    // Notify client to sync
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_VISITS' });
    });
  } catch (err) {
    console.error('[SW] Sync visits failed:', err);
  }
}

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'มีข้อมูลใหม่',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
    },
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'BAAC Field Route', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(event.notification.data.url);
    })
  );
});
