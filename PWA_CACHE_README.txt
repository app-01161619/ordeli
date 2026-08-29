Ordeli PWA cache/versioning fix

Replace:
- index.html
- sw.js
- _headers

Do not replace:
- js/supabase.js
- js/app.js
- css/style.css
- manifest.webmanifest
- icons

How it works:
- HTML, JS and CSS use NETWORK-FIRST, so a new deploy is preferred.
- The service worker checks for an update on each app launch.
- Old service-worker caches are deleted during activation.
- Cloudflare is instructed not to cache index.html or sw.js.
- index.html gives app.js a deploy version query string so the browser
  treats a changed JS file as a new resource URL.

IMPORTANT FOR FUTURE DEPLOYS:
When app.js or CSS changes, increment the version in:
  index.html -> ?v=2026-08-29-04
  sw.js -> CACHE_VERSION = "ordeli-v2026-08-29-04"

If only database changes and no frontend asset changes, no version bump
is required.
