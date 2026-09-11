create or replace function public.set_seller_payment_method(p_payment_id uuid, p_payment_method text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_method text := lower(trim(coalesce(p_payment_method, '')));
begin
  if v_user is null then
    raise exception 'Authentication required.' using errcode='42501';
  end if;
  if v_method not in ('cash','bank_transfer','digital_wallet') then
    raise exception 'Invalid payment method.' using errcode='22023';
  end if;
  select * into v_payment
  from public.payments
  where id = p_payment_id
    and seller_id = v_user
  for update;
  if not found then
    raise exception 'Payment not found.' using errcode='P0002';
  end if;
  update public.payments
  set payment_method = v_method
  where id = v_payment.id
    and seller_id = v_user;
  return jsonb_build_object('updated', true, 'payment_id', v_payment.id, 'payment_method', v_method);
end;
$$;

revoke insert on table public.payments from authenticated;
revoke update on table public.payments from authenticated;

drop policy if exists "Payments sellers can create own" on public.payments;
drop policy if exists "payment_insert_own" on public.payments;
drop policy if exists "payment_update_own" on public.payments;

grant execute on function public.set_seller_payment_method(uuid, text) to authenticated;
;
