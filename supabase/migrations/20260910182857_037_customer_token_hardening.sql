begin;

do $$
declare
  v_def text;
begin
  -- Customer cancellation: require an assigned QR.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='cancel_customer_order_item'
    and pg_get_function_identity_arguments(p.oid)='p_public_token text, p_reason text';
  v_def := replace(v_def,
    'where public_token = p_public_token limit 1;',
    'where public_token = p_public_token and status = ''assigned'' limit 1;');
  execute v_def;

  -- Post-purchase actions: require an assigned QR.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_customer_post_purchase_actions'
    and pg_get_function_identity_arguments(p.oid)='p_public_token text';
  v_def := replace(v_def,
    'where public_token = p_public_token limit 1;',
    'where public_token = p_public_token and status = ''assigned'' limit 1;');
  execute v_def;

  -- Customer fulfillment mutation: require an assigned QR.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_customer_fulfillment'
    and pg_get_function_identity_arguments(p.oid)='p_public_token text, p_fulfillment_type text, p_event_id uuid';
  v_def := replace(v_def,
    'where public_token = p_public_token\n  limit 1;',
    'where public_token = p_public_token\n    and status = ''assigned''\n  limit 1;');
  execute v_def;

  -- Customer reviews: require an assigned QR.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='submit_customer_review'
    and pg_get_function_identity_arguments(p.oid)='p_public_token text, p_rating integer, p_review_text text';
  v_def := replace(v_def,
    'select * into v_qr from public.qr_codes where public_token = p_public_token limit 1;',
    'select * into v_qr from public.qr_codes where public_token = p_public_token and status = ''assigned'' limit 1;');
  execute v_def;

  -- Customer tracking: revoked tokens are no longer valid.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_customer_tracking'
    and pg_get_function_identity_arguments(p.oid)='p_public_token text';
  v_def := replace(v_def,
    'and status in (''assigned'', ''revoked'')',
    'and status = ''assigned''');
  execute v_def;
end $$;

-- Pin non-definer helper search paths to remove mutable-path warnings.
alter function public.qr_product_prefix(text) set search_path = public;
alter function public.set_updated_at() set search_path = public;

-- Storage defense in depth. The application/Worker still validates image content.
update storage.buckets
set file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id in ('payment-proofs','production-proofs');

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'shop-logos';

commit;;
