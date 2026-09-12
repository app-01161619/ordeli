begin;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'submit_customer_payment_proof'
    and pg_get_function_identity_arguments(p.oid) =
      'p_public_token text, p_amount numeric, p_proof_path text';

  if v_def is null then
    raise exception 'submit_customer_payment_proof function was not found';
  end if;

  if position('Payment proof can be submitted after production is completed.' in v_def) > 0 then
    v_def := replace(
      v_def,
      'raise exception ''Payment proof can be submitted after production is completed.'';',
      'null;'
    );
    execute v_def;
  end if;
end
$$;

commit;
