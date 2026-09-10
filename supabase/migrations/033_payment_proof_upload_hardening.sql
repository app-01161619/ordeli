-- Move unauthenticated payment-proof uploads behind the Cloudflare Worker.
-- The Worker validates the tracking token, order payment state, amount, file
-- type/signature and size before writing the private object and creating the
-- payment record with the service key.

begin;

drop policy if exists "customer_can_upload_payment_proofs" on storage.objects;

-- Ensure public API roles cannot write to this bucket directly. Seller reads
-- and deletes remain controlled by the existing seller policies.
revoke insert on table storage.objects from anon, authenticated;

notify pgrst, 'reload schema';
commit;
