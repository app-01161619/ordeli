// Bump this on every deploy that changes any cached file — it's what
// forces old clients to fetch the new versions instead of serving stale
// cached copies forever.
const CACHE_NAME = 'ordeli-shell-v1';

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
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
