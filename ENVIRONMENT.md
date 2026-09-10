# Ordeli Worker environment

Configure the Cloudflare Worker with:

- `SUPABASE_URL` — the Supabase project URL
- `SUPABASE_SECRET_KEY` — the Supabase secret API key (`sb_secret_...`)

The Worker also temporarily accepts the legacy `SUPABASE_SERVICE_ROLE_KEY` name for compatibility, but new deployments should use `SUPABASE_SECRET_KEY`.

Never place the secret key in browser files such as `customer/customer.js`, `js/app.js`, or `index.html`.
