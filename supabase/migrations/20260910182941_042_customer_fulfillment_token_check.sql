begin;
do $$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_customer_fulfillment'
    and pg_get_function_identity_arguments(p.oid)='p_public_token text, p_fulfillment_type text, p_event_id uuid';
  if v_def is null then raise exception 'set_customer_fulfillment function not found'; end if;
  v_old := v_def;
  v_def := replace(v_def, 'where public_token = p_public_token', 'where public_token = p_public_token and status = ''assigned''');
  if v_def = v_old then raise exception 'Could not locate token lookup in set_customer_fulfillment'; end if;
  execute v_def;
end $$;
commit;;
