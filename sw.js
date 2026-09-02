/* Ordeli seller PWA service worker. Customer /t/ pages intentionally do not register this worker. */
const CACHE_VERSION = "ordeli-v2026-09-02-04";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest"];

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
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never let the seller worker handle customer tracking URLs.
  if (url.pathname.startsWith("/t/")) return;

  const pathname = url.pathname.toLowerCase();
  const networkFirst =
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith("/");

  if (networkFirst) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            event.waitUntil(
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()))
            );
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/index.html");
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          event.waitUntil(
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()))
          );
        }
        return response;
      });
    })
  );
});
