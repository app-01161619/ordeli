ORD ELI — STEP 8 CUSTOMER TRACKING

This step adds the first customer-facing tracking page at:
  /t/<secure-public-token>

Included:
- Public customer tracking screen in the existing single-page app.
- Specific product/order-item production timeline.
- Order-level "View My Order" summary.
- Customer-visible payment summary (total, paid, remaining, status).
- Secure Supabase RPC: get_customer_tracking(text)
- Anonymous access only through that RPC; customer pages do not query private tables directly.
- App JS cache-busting and service-worker version bump.

RUN THIS SQL IN SUPABASE:
  supabase/008_customer_tracking.sql

Then deploy the project to Cloudflare Pages.

NOTE:
Production proof photo viewing, customer payment-proof upload, fulfillment selection, pickup scheduling, courier selection, and reviews are intentionally not added in this step. They remain later incremental features from the master prompt.
