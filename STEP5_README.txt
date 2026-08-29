Ordeli Step 5 — QR Printing

Replace:
- index.html
- js/app.js
- css/style.css

Keep:
- js/supabase.js with your real credentials
- manifest.webmanifest
- sw.js
- _headers only if your currently working deployment uses one

No new SQL is required.

From QR Management:
QR series -> Print -> choose available pair count -> Prepare Preview -> Print.

Each pair contains a seller copy and customer copy using the same QR/public
tracking token. The customer card contains shop name, product name, QR code,
instruction, and written tracking URL.

Target card size: 85.6 x 54 mm.
