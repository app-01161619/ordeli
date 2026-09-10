-- Move unauthenticated payment-proof uploads behind the Cloudflare Worker.
-- The Worker validates the tracking token, order payment state, amount, file
-- type/signature and size before writing the private object and creating the
-- payment record with the service key.

begin;

drop policy if exists "customer_can_upload_payment_proofs" on storage.objects;

-- The direct anonymous upload policy is removed above. Do not change the
-- global storage.objects INSERT privilege here because other authenticated
-- upload flows use different buckets and bucket-specific RLS policies.
revoke insert on table storage.objects from anon;

notify pgrst, 'reload schema';
commit;
