ORD​ELI STEP 8 — CUSTOMER SIDE SEPARATION

Replace/add only these files from this ZIP:

1. index.html
2. js/app.js
3. css/style.css
4. customer/index.html (NEW)
5. customer/customer.js (NEW)
6. customer/customer.css (NEW)
7. worker.js (NEW)
8. wrangler.jsonc (NEW)

No new Supabase SQL is required; 008_customer_tracking.sql already exists.

Cloudflare routing:
/t/<token> -> /customer/index.html
Everything else -> normal static assets.
