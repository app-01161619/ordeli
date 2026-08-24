// Only needs bumping if a file is ever *removed* from APP_SHELL — content
// changes to existing files now refresh automatically in the background
// (see the fetch handler below), so this isn't the freshness mechanism
// anymore. It still forces this exact transition once, for anyone whose
// phone is stuck on the old cache-first version.
const CACHE_NAME = 'ordeli-shell-v2';

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/config.js',
  '/js/supabase-client.js',
  '/js/auth.js',
  '/js/shop.js',
  '/js/connection-status.js',
  '/js/router.js',
  '/js/app.js',
  '/js/pages/sign-in.js',
  '/js/pages/onboarding.js',
  '/js/pages/home.js',
  '/js/pages/orders.js',
  '/js/pages/scan.js',
  '/js/pages/events.js',
  '/js/pages/more.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle our own static files. Supabase API/storage calls (and
  // anything else cross-origin) go straight to the network, untouched —
  // caching those would risk serving stale or wrong data, and queueing
  // them for offline use is a separate, more deliberate feature to build
  // later (see README).
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      // Always refresh in the background, cache hit or not — this is what
      // lets a normal deploy show up on the next load without depending on
      // CACHE_NAME being bumped by hand. event.waitUntil keeps the worker
      // alive long enough for the cache.put to finish even though the
      // response itself doesn't wait for it.
      const refreshed = fetch(request)
        .then((response) => {
          cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      event.waitUntil(refreshed);

      return cached || (await refreshed) || caches.match('/index.html');
    })
  );
});
