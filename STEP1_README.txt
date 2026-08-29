Ordeli Step 1 Rebuild

Run order:
1. If intentionally resetting development data, run supabase/000_reset_dev.sql.
2. Run supabase/001_seller_shop.sql.
3. Put your Supabase URL and publishable key in js/supabase.js.
4. Configure Google in Supabase Auth and add your local/production redirect URL.
5. Keep your existing manifest.webmanifest, sw.js, _headers and icons.

This step only implements seller account + shop:
- Google login/signup
- Email/password login/signup
- Persistent Supabase session
- Shop name
- Shop address
- Optional shop logo
- Temporary Home

Do not add later feature migrations yet.
