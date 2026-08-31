Ordeli Step 7 — Simplified Payment Entry

The seller no longer chooses Payment Type.

Seller UI:
  Amount
  [Record Payment]

Ordeli automatically stores:
- first payment -> downpayment
- payment that clears balance -> final
- other payments -> additional

The payment_type column remains in the database for records/history.

No SQL changes are required.

Replace:
- index.html
- js/app.js
- css/style.css

Keep:
- js/supabase.js
- sw.js
- manifest.webmanifest
- current Cloudflare files
