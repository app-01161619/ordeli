-- Corrective migration for the hardening pass.
-- 033 intentionally removed the customer anonymous upload policy, but must not
-- revoke INSERT globally from storage.objects because authenticated seller and
-- production workflows still upload to other buckets.
-- 034 used a broad function EXECUTE revoke; this migration restores only the
-- RPCs currently called by the application and keeps customer RPCs anonymous
-- by token while seller/member RPCs remain authenticated-only.

begin;

-- Restore authenticated Storage writes so existing seller/member upload flows
-- can continue to operate under their bucket-specific RLS policies.
grant insert on table storage.objects to authenticated;
revoke insert on table storage.objects from anon;

-- Keep the customer payment-proofs bucket protected by policy rather than a
-- global table privilege. The anonymous direct-upload policy was already
-- removed by 033, so the browser cannot write directly to this bucket.
drop policy if exists "customer_can_upload_payment_proofs" on storage.objects;

-- Explicitly restore application RPC execution grants after the broad revoke
-- in 034. The function-name checks also work across overloaded signatures.
do $$
declare
  r record;
  v_customer constant text[] := array[
    'get_customer_fulfillment',
    'set_customer_fulfillment',
    'get_customer_payment_proof',
    'submit_customer_payment_proof',
    'get_customer_post_purchase_actions',
    'submit_customer_review',
    'cancel_customer_order_item',
    'get_production_invite',
    'reschedule_customer_pickup',
    'get_customer_stage_proof',
    'get_customer_stage_proof_v2',
    'get_customer_tracking'
  ];
  v_authenticated constant text[] := array[
    'sync_offline_order_v4',
    'sync_offline_order_v5',
    'create_production_member_invite',
    'get_current_actor',
    'get_production_work',
    'accept_production_member_invite',
    'production_member_can_upload_to_seller',
    'resolve_production_qr',
    'finish_production_stage_member_v2',
    'update_order_pickup_status',
    'reschedule_event_orders',
    'review_customer_payment',
    'add_order_item_online',
    'create_order_from_qr',
    'finish_production_stage',
    'generate_qr_series',
    'revoke_qr_code',
    'reserve_qr_codes_for_offline',
    'release_qr_reservations_for_offline',
    'seller_record_payment',
    'seller_cancel_order_item',
    'seller_cancel_order',
    'update_production_member',
    'set_production_member_active'
  ];
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(v_customer)
  loop
    execute format('grant execute on function %s to anon, authenticated', r.oid::regprocedure);
  end loop;

  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(v_authenticated)
  loop
    execute format('grant execute on function %s to authenticated', r.oid::regprocedure);
  end loop;
end;
$$;

-- Defense-in-depth: these trigger/helper functions are never part of the
-- browser API surface.
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'queue_sms_update',
        'trg_order_item_sms_update',
        'trg_stage_log_sms_update',
        'trg_payment_sms_update',
        'trg_order_pickup_sms_update',
        'trg_event_schedule_sms_update'
      ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.oid::regprocedure);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
