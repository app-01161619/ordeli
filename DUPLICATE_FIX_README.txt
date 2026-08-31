This package combines the previously successful duplicate-display fix
(from the uploaded reference ZIP) with the current QR-management and
side-by-side QR-printing implementation.

The duplicate entries were frontend-only: multiple startup/auth/hash renders
could fetch the same single database row and append it more than once.

Fix:
- one renderApplication() operation at a time
- same-route navigation does not render again
- Products are rebuilt from one snapshot
- QR Series are rebuilt from one snapshot
- stale route results are ignored

Replace:
- index.html
- js/app.js
- css/style.css

Keep:
- js/supabase.js with your real credentials
- sw.js
- manifest.webmanifest
- your currently working Cloudflare files

No SQL changes are required.
