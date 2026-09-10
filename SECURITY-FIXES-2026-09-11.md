# Ordeli Security Fixes — 2026-09-11

This build continues the security hardening pass for the Ordeli PWA.

## Included

- Customer tracking links from `/t/<token>` are redirected to `/customer/#token=...` so the bearer token is not placed in the initial HTTP query string.
- Legacy customer `?token=` links remain supported for compatibility.
- Revoked QR codes no longer authorize production-proof lookup through the hardened v2 proof function.
- Customer production-proof viewing now goes through `/api/customer-stage-proof`; the browser no longer calls the older proof RPC directly.
- The proof API is GET-only and returns generic public errors.
- Customer payment-proof uploads go through `/api/customer-payment-proof` and are validated server-side for token eligibility, amount, file size, MIME type, and file signature before Storage upload.
- Direct anonymous payment-proof Storage upload policy is removed without revoking Storage INSERT globally for authenticated seller/production workflows.
- Public RPC execution privileges are explicitly allowlisted; seller/member RPCs remain authenticated-only.
- Internal SMS helper/trigger functions are not browser-callable.
- PWA app-shell caching includes the boot files needed for a fresh offline start.
- The seller service worker does not control `/customer/`.
- Dynamic runtime `<style>` injection was removed in favor of CSP-compatible stylesheet rules.
- Stale nested customer application files and editor/OS junk are excluded from the deployment package.
- `.gitignore` now covers environment files, build output, Wrangler state, editor files, and OS junk.

## Supabase migration order

Apply these hardening migrations to the existing Supabase project in order:

1. `032_security_hardening.sql`
2. `033_payment_proof_upload_hardening.sql`
3. `034_rpc_privilege_hardening.sql`
4. `035_hardening_corrections.sql`
5. `036_customer_proof_rpc_surface.sql`

`036_customer_proof_rpc_surface.sql` removes anonymous/authenticated execute access to the older `get_customer_stage_proof` RPC because the customer UI now uses the Worker endpoint and the hardened `get_customer_stage_proof_v2` implementation.

## Cloudflare Worker secrets

Set these Worker variables/secrets:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Legacy secret variable names are still accepted by the Worker for compatibility, but a Supabase secret/service-role key must never be placed in frontend JavaScript.

## Remaining live-environment audit

The repository does not contain the complete historical RLS/Storage policy migration chain. Before treating the database as fully audited, inspect the live Supabase project for:

- RLS enabled on every application table.
- Seller/member policies constrained by `auth.uid()` and seller ownership.
- Private Storage buckets for proof images.
- Production-proof upload/delete/read policies scoped to the correct seller/member.
- No anonymous `INSERT` policy on `payment-proofs`.
- Customer RPCs validating bearer tokens and rejecting revoked/ineligible tokens.
- No unintended `EXECUTE` grants on other `SECURITY DEFINER` functions.
