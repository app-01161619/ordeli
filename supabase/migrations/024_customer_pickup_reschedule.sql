begin;

create or replace function public.reschedule_customer_pickup(
  p_public_token text,
  p_new_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_old_event uuid;
  v_event public.events%rowtype;
begin
  if nullif(trim(coalesce(p_public_token, '')), '') is null then
    raise exception 'Tracking token is required.';
  end if;
  if p_new_event_id is null then
    raise exception 'Choose a new pickup event.';
  end if;

  select q.* into v_qr
  from public.qr_codes q
  where q.public_token = p_public_token
    and q.status = 'assigned'
    and q.order_item_id is not null
  limit 1;
  if not found then
    raise exception 'This tracking link is unavailable.';
  end if;

  select oi.* into v_item
  from public.order_items oi
  where oi.id = v_qr.order_item_id
    and oi.cancelled_at is null
  limit 1;
  if not found then
    raise exception 'Order item not found.';
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = v_item.order_id
    and o.cancelled_at is null
  for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  if v_order.handed_over_at is not null then
    raise exception 'This order has already been handed over.';
  end if;
  if v_order.fulfillment_type <> 'location' or v_order.pickup_status <> 'unclaimed' then
    raise exception 'Pickup can only be rescheduled after an unclaimed event pickup.';
  end if;

  select * into v_event
  from public.events e
  where e.id = p_new_event_id
    and e.seller_id = v_order.seller_id
    and lower(e.status) in ('upcoming','ready','active')
    and e.event_date >= current_date
  limit 1;
  if not found then
    raise exception 'That pickup event is no longer available.';
  end if;

  v_old_event := v_order.event_id;
  if v_old_event = p_new_event_id then
    raise exception 'Choose a different pickup event.';
  end if;

  update public.orders
  set event_id = p_new_event_id,
      pickup_status = 'scheduled',
      updated_at = now()
  where id = v_order.id;

  insert into public.order_event_history(
    order_id, old_event_id, new_event_id, reason, occurred_at
  ) values (
    v_order.id, v_old_event, p_new_event_id, 'Customer rescheduled pickup', now()
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'old_event_id', v_old_event,
    'new_event_id', p_new_event_id,
    'pickup_status', 'scheduled'
  );
end;
$$;

grant execute on function public.reschedule_customer_pickup(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
