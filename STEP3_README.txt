Ordeli Step 3 — Product Production Workflow

Replace:
- index.html
- js/app.js
- css/style.css

Keep your working:
- js/supabase.js
- manifest.webmanifest
- sw.js
- _headers
- icons

DATABASE:
The master schema already contains public.production_stages, so no new SQL is required for this step.

Step 3 provides:
- Workflow button on each product
- Add production stage
- Rename production stage
- Move stage up
- Move stage down
- Remove stage
- Save ordered workflow
- Seller-owned product/stage access through the existing RLS

Example:
Product: Mug
1. Design
2. Printing
3. Quality Check
4. Packing

Do not add QR, order, payment, production execution, or customer tracking features yet.
