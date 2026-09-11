begin;
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_customer_fulfillment'
    and pg_get_function_identity_arguments(p.oid)='p_public_token text, p_fulfillment_type text, p_event_id uuid';
  if v_def is null then raise exception 'set_customer_fulfillment function not found'; end if;
  v_def := replace(v_def,
    '  where public_token = p_public_token\r\n  limit 1;',
    '  where public_token = p_public_token\r\n    and status = ''assigned''\r\n  limit 1;');
  v_def := replace(v_def,
    '  where public_token = p_public_token\n  limit 1;',
    '  where public_token = p_public_token\n    and status = ''assigned''\n  limit 1;');
  execute v_def;
end $$;
commit;;
