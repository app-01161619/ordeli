# Ordeli security and reliability fixes — 2026-09-11

This package includes a focused hardening pass based on the 2026-09-10 project scan.

## Included fixes

- Removed the stale duplicate customer application at `customer/customer/`.
- `/t/<token>` redirects now place the customer bearer token in the URL fragment instead of a query string. Old `?token=` customer URLs remain supported for backward compatibility.
- Revoked QR codes are no longer accepted by `get_customer_stage_proof_v2`.
- Added `supabase/migrations/032_security_hardening.sql` to apply the revoked-token fix to the database.
- The Cloudflare Worker now reads `SUPABASE_URL` from its environment instead of hardcoding the project URL.
- The public proof endpoint accepts only GET and no longer returns upstream Supabase/Storage error text to customers.
- Worker errors are logged server-side with a generic public response.
- The seller service worker shell now includes `boot.js` and `register-sw.js`, fixing an offline first-load gap.
- The seller service worker explicitly leaves `/customer/` pages alone.
- Offline sync recovery styles were moved from a runtime `<style>` injection into the main stylesheet so the existing `style-src 'self'` CSP remains compatible.
- Strengthened `.gitignore` for local secrets, Wrangler state, dependencies, build output, and editor temporary files.

## Important remaining deployment work

The repository still relies on the live Supabase database for the full RPC/security history. The ZIP contains current schema snapshots plus the historical SQL in Git history, but it is not yet a clean, from-scratch Supabase migration chain. Before creating a new Supabase project, export/validate the live schema and RLS policies, then establish a single authoritative migration baseline.

Payment-proof uploads should also be moved behind a server-validated upload flow with server-side file-size/type limits and rate limiting before production launch.

External JavaScript libraries are still loaded from pinned CDNs. They should eventually be self-hosted/bundled (or protected with verified SRI hashes) for a stronger supply-chain boundary.

## Second hardening pass

- Customer payment-proof uploads now go through `POST /api/customer-payment-proof` instead of direct anonymous Storage INSERT.
- The Worker validates token/payment eligibility, amount, size, MIME type, and image magic bytes before upload.
- `supabase/migrations/033_payment_proof_upload_hardening.sql` removes the public Storage INSERT policy for payment proofs.
- `supabase/migrations/034_rpc_privilege_hardening.sql` revokes PostgREST EXECUTE from all public-schema functions and restores only the known customer/authenticated application RPCs.
- Worker payment-proof responses avoid returning raw Supabase error messages to the browser.
