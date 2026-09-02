/* Ordeli seller PWA service worker.
   Customer tracking pages (/t/<token>) do not use this worker. */

const CACHE_VERSION = "ordeli-v2026-09-02-05";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest"
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never handle customer tracking pages.
  if (url.pathname.startsWith("/t/")) return;

  const pathname = url.pathname.toLowerCase();
  const networkFirst =
    pathname === "/" ||
    pathname.endsWith("/") ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css");

  if (networkFirst) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((cached) => {
        return cached || caches.match("/index.html");
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
