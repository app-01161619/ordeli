Ordeli PWA cache fix — Cloudflare build-safe version

IMPORTANT:
The previous _headers file has been intentionally REMOVED.

Your Cloudflare build failed while parsing _headers. Current Cloudflare
Workers/Pages static assets already use revalidation-friendly cache behavior
for static assets, so we do not need _headers just to prevent stale app code.

Replace:
- index.html
- sw.js

Delete from your project:
- _headers

Keep unchanged:
- js/app.js
- js/supabase.js
- css/style.css
- manifest.webmanifest
- icons

Cache/update behavior:
1. HTML/JS/CSS are fetched network-first by sw.js.
2. sw.js checks for a newer service worker on every app launch.
3. Old service-worker caches are deleted during activation.
4. index.html gives app.js a version query string.

FUTURE FRONTEND DEPLOYS:
When frontend code changes, increment both versions, for example:
  index.html: ./js/app.js?v=2026-08-29-04
  sw.js: const CACHE_VERSION = "ordeli-v2026-08-29-04";

No SQL changes are involved.
