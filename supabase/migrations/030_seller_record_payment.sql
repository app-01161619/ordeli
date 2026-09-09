-- Seller-recorded payments are treated as already confirmed.
-- This supports cash/in-person payments and other payments handled directly by the seller.

create or replace function public.seller_record_payment(
  p_order_id uuid,
  p_amount numeric,
  p_payment_type text default 'additional'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_payment_id uuid;
  v_type text := lower(trim(coalesce(p_payment_type, 'additional')));
begin
  if v_user is null then
    raise exception 'Authentication required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  if v_type not in ('additional', 'final', 'cash', 'other') then
    raise exception 'Invalid payment type.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
    and seller_id = v_user
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  if v_order.cancelled_at is not null then
    raise exception 'A cancelled order cannot receive a payment.';
  end if;

  select coalesce(sum(oi.total_price), 0)
    into v_total
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.seller_id = v_user
    and oi.cancelled_at is null;

  select coalesce(sum(p.amount), 0)
    into v_paid
  from public.payments p
  where p.order_id = v_order.id
    and p.seller_id = v_user
    and coalesce(p.proof_status, 'confirmed') <> 'rejected';

  v_remaining := greatest(0, v_total - v_paid);

  if v_remaining <= 0 then
    raise exception 'This order is already fully paid.';
  end if;

  if p_amount > v_remaining + 0.005 then
    raise exception 'Payment cannot exceed the remaining balance of %.', to_char(v_remaining, 'FM999999990.00');
  end if;

  insert into public.payments (
    order_id,
    seller_id,
    amount,
    payment_type,
    proof_status,
    proof_path,
    rejection_reason,
    confirmed_by_user_id,
    confirmed_at
  ) values (
    v_order.id,
    v_user,
    round(p_amount, 2),
    v_type,
    'confirmed',
    null,
    null,
    v_user,
    now()
  )
  returning id into v_payment_id;

  return jsonb_build_object(
    'recorded', true,
    'payment_id', v_payment_id,
    'order_id', v_order.id,
    'amount', round(p_amount, 2),
    'remaining_before', round(v_remaining, 2),
    'remaining_after', greatest(0, round(v_remaining - p_amount, 2))
  );
end;
$$;

revoke all on function public.seller_record_payment(uuid, numeric, text) from public;
revoke all on function public.seller_record_payment(uuid, numeric, text) from anon;
revoke all on function public.seller_record_payment(uuid, numeric, text) from authenticated;
grant execute on function public.seller_record_payment(uuid, numeric, text) to authenticated;
