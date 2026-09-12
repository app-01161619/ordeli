# Ordeli PWA — Continuation Audit

Date: 2026-09-13

## Completed in this pass

### 1. Offline production-sync ID mapping
Offline-created order items use local `offline-item:<client id>` identifiers until their parent order/item exists on the server. The sync worker now resolves those local IDs to the real Supabase `order_items.id` before calling production-stage RPCs or updating `stage_logs`.

### 2. Offline “Add another item” mapping
The offline add-item path previously generated a local item ID unrelated to the queue row that would later create the server item. It now derives the local item ID from the queue row's `clientOrderId`, so it can be resolved deterministically after reconnect.

### 3. Offline add-item payment cache
When an additional downpayment is recorded while offline, the local order payment snapshot is updated immediately instead of waiting for the network sync.

### 4. Customer tracking payment correctness
`get_customer_tracking()` previously summed all payments, including customer-submitted proofs that were still pending or had been rejected. The live function now counts only direct payments and customer proofs whose `proof_status` is NULL or `confirmed`.

### 5. Production proof correctness after rework
`get_customer_stage_proof_v2()` now ignores a proof photo from a production attempt when that stage was subsequently sent back for rework. Customers therefore do not see a stale proof from an invalidated stage completion.

### 6. Seller payment-method RPC exposure
`set_seller_payment_method()` was executable through the `PUBLIC` role even though the function requires seller authentication. Anonymous execution has been revoked while authenticated execution remains enabled.

### 7. PWA cache/update version
The application/service-worker version was bumped from `2026-09-11-01` to `2026-09-13-01` so the updated `app.js` is not trapped behind the old service-worker cache on installed devices.

### 8. Active-customer UI consistency
The seller-side active-customer selector now only loads customers with at least one non-cancelled, non-handed-over order, matching the product definition of an active customer.

## Validation performed

- `node --check` passed for `js/app.js`, `js/boot.js`, and `sw.js` after the changes.
- Supabase was queried directly to verify the updated function definitions.
- Supabase verified `set_seller_payment_method()` has `anon` EXECUTE = false and `authenticated` EXECUTE = true.
- Supabase security advisor confirms the anonymous security-definer warning count dropped from 13 to 12 after removing the unintended public access to the seller-only payment-method function.
- Supabase reports RLS enabled on all 17 public application tables.

## Remaining important work

1. Finish a full end-to-end offline test matrix on a real device, especially: offline create → production completion → reconnect → production completion server reconciliation; offline add-item → production completion; offline proof photo upload; and reconnect/reload while multiple queue rows are pending.
2. Reconcile the repository SQL migrations with the live Supabase database. The live project contains additional RPCs/RLS policies that are not represented by the current migration folder, so the repository is not yet a complete reproducible database source of truth.
3. Tighten and review every SECURITY DEFINER RPC against its exact role requirement. Customer-token RPCs are intentionally public, but each must remain narrowly scoped to the supplied secure token.
4. Address Supabase performance advisories: seven foreign-key indexes, three auth-RLS initplan policies, duplicate indexes, and overlapping permissive policies. These are optimization/maintenance tasks rather than immediate functional blockers.
5. Enable leaked-password protection in Supabase Auth.
6. Continue functional QA of Events, production-team invite/authentication, customer tracking, payment verification, fulfillment, handover/unclaimed/reschedule, reviews, and QR printing using the finalized business rules.

## Scope note

This is a continuation patch, not a claim that the entire unfinished application is complete. The supplied product prompt remains the authoritative business-rule source.
