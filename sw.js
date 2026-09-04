/* Ordeli seller PWA service worker.
   Customer tracking pages (/t/<token>) do not use this worker. */

const CACHE_VERSION = "ordeli-v2026-09-04-12";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/css/style.css",
  "/js/supabase.js",
  "/js/app.js?v=2026-09-04-13"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "ordeli-offline-orders") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => clients.forEach((client) => client.postMessage({ type: "ordeli-sync-request" })))
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/t/")) return;

  const isAppAsset =
    url.pathname === "/" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest");

  if (isAppAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_VERSION)
              .then((cache) => cache.put(request, response.clone()))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});


const CDN_CACHE = "ordeli-cdn-v2026-09-04-12";
const CDN_HOSTS = new Set(["cdnjs.cloudflare.com", "unpkg.com"]);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!CDN_HOSTS.has(url.hostname)) return;
  event.respondWith(
    caches.open(CDN_CACHE).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === "opaque")) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw _;
      }
    })
  );
});
