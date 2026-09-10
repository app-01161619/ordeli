-- Lock down PostgREST RPC execution privileges.
-- SECURITY DEFINER functions must not inherit the PostgreSQL default EXECUTE
-- privilege for PUBLIC. Customer-facing functions are explicitly public via
-- anon/authenticated; seller/member functions are explicitly authenticated.

begin;

revoke execute on all functions in schema public from public, anon, authenticated;

do $$
declare
  r record;
  v_customer text[] := array[
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
  v_authenticated text[] := array[
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
    'update_production_member',
    'set_production_member_active',
    'seller_cancel_order_item',
    'seller_cancel_order'
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

notify pgrst, 'reload schema';
commit;
