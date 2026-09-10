# Ordeli Worker environment

Configure the Cloudflare Worker with:

- `SUPABASE_URL` — the Supabase project URL
- `SUPABASE_SECRET_KEY` — the Supabase secret API key (`sb_secret_...`)

The Worker also temporarily accepts the legacy `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_SERVICE_KEY` names for compatibility, but new deployments should use `SUPABASE_SECRET_KEY`.

Never place the secret key in browser files such as `customer/customer.js`, `js/app.js`, or `index.html`.

## Public tracking tokens

Printed QR cards use `/t/<public-token>`. Cloudflare redirects this route to `/customer/#token=<public-token>`, so the bearer token is kept in the browser URL fragment rather than sent to the server as a query parameter. The customer app still accepts legacy `/customer/?token=<public-token>` links for compatibility.

## Database hardening

Apply `supabase/migrations/032_security_hardening.sql` to the active Supabase project after the existing schema/functions are present. It makes revoked QR tokens invalid for customer production-proof lookup.

## Payment proof upload hardening

Customer payment proofs are submitted through the same-origin Cloudflare Worker endpoint
`POST /api/customer-payment-proof`. The Worker validates the bearer tracking token, checks
payment eligibility and amount through Supabase, enforces an 8 MB image limit, checks JPG/PNG/WebP
file signatures, uploads the object with the secret key, and then records the payment via the
existing `submit_customer_payment_proof` RPC.

Apply `supabase/migrations/033_payment_proof_upload_hardening.sql` after the existing payment-proof
schema/policies are present. Do not restore a public `INSERT` policy for `payment-proofs`, because
that would bypass the Worker-side validation.

## RPC privilege hardening

Apply `supabase/migrations/034_rpc_privilege_hardening.sql` after the existing functions are present.
It revokes PostgREST EXECUTE from public roles and restores access only to the explicitly known
customer or authenticated seller/member RPC names used by the current app. Internal trigger/helper
functions therefore remain unavailable as API RPCs.
