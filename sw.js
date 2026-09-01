/*
 * Ordeli PWA Service Worker
 *
 * Cache policy:
 * - HTML / JS / CSS: NETWORK FIRST
 *   This prevents old application code from being served after a deploy.
 * - Images / fonts / other static assets: CACHE FIRST
 *   with network fallback.
 *
 * Update this CACHE_VERSION whenever you make a deployment that changes
 * files handled by the service worker. Old caches are deleted on activate.
 */

const CACHE_VERSION = "ordeli-v2026-09-02-02";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest"
];


/* ------------------------------------------------------------
   INSTALL
------------------------------------------------------------ */

self.addEventListener("install", (event) => {

  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );

});


/* ------------------------------------------------------------
   ACTIVATE
------------------------------------------------------------ */

self.addEventListener("activate", (event) => {

  event.waitUntil(

    caches
      .keys()
      .then((keys) => {

        return Promise.all(

          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))

        );

      })
      .then(() => self.clients.claim())

  );

});


/* ------------------------------------------------------------
   FETCH
------------------------------------------------------------ */

self.addEventListener("fetch", (event) => {

  const request =
    event.request;


  // Only handle normal GET requests.
  if (
    request.method !== "GET"
  ) {
    return;
  }


  const url =
    new URL(request.url);


  // Don't interfere with external resources.
  if (
    url.origin !== self.location.origin
  ) {
    return;
  }


  const pathname =
    url.pathname.toLowerCase();


  /*
   * NETWORK-FIRST:
   *
   * These files control the running application.
   * We always prefer the newest server copy.
   */

  const networkFirst =
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith("/");


  if (networkFirst) {

    event.respondWith(

      fetch(request)
        .then((response) => {

          /*
           * Cache a successful response as a fallback only.
           * This is not used as the preferred source.
           */

          if (
            response &&
            response.ok
          ) {

            const copy =
              response.clone();

            caches
              .open(CACHE_VERSION)
              .then((cache) => {
                cache.put(
                  request,
                  copy
                );
              });

          }


          return response;

        })
        .catch(async () => {

          /*
           * Offline fallback.
           */

          const cached =
            await caches.match(
              request
            );

          if (cached) {
            return cached;
          }


          return caches.match(
            "./index.html"
          );

        })

    );

    return;
  }


  /*
   * CACHE-FIRST:
   *
   * Images, icons, manifest-adjacent assets, etc.
   */

  event.respondWith(

    caches.match(request)
      .then((cached) => {

        if (cached) {
          return cached;
        }


        return fetch(request)
          .then((response) => {

            if (
              response &&
              response.ok
            ) {

              const copy =
                response.clone();

              caches
                .open(CACHE_VERSION)
                .then((cache) => {

                  cache.put(
                    request,
                    copy
                  );

                });

            }


            return response;

          });

      })

  );

});
