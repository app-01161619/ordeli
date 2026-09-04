/* Ordeli seller PWA service worker.
   Customer tracking pages (/t/<token>) do not use this worker. */

const CACHE_VERSION = "ordeli-v2026-09-04-orderflow-02";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/css/style.css",
  "/js/supabase.js",
  "/js/app.js?v=2026-09-04-orderflow-02"
];

const SCANNER_LIBRARIES = [
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(async (cache) => {
        await Promise.all(SCANNER_LIBRARIES.map(async (url) => {
          try {
            const request = new Request(url, { mode: "no-cors" });
            const response = await fetch(request);
            if (response && response.type === "opaque") await cache.put(request, response);
          } catch (_) {
            // The app can still install when a third-party CDN is temporarily unavailable.
          }
        }));
      })
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isScannerLibrary =
    request.destination === "script" &&
    (url.hostname === "cdnjs.cloudflare.com" || url.hostname === "unpkg.com");

  if (isScannerLibrary) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response && (response.ok || response.type === "opaque")) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone())).catch(() => {});
          }
          return response;
        })
      ).catch(() => caches.match(request))
    );
    return;
  }

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
