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
