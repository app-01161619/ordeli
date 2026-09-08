begin;

-- The orders.fulfillment_type column is NOT NULL, and an order can exist
-- before the customer chooses fulfillment. Use an explicit "not_selected"
-- value for that state instead of NULL.
update public.orders
set fulfillment_type = case
  when fulfillment_type is null or btrim(fulfillment_type) = '' then 'not_selected'
  when lower(btrim(fulfillment_type)) in (
    'not_selected', 'not selected', 'pending', 'none'
  ) then 'not_selected'
  when lower(btrim(fulfillment_type)) in (
    'shop', 'pickup_at_shop', 'pickup_shop', 'shop_pickup', 'at_shop', 'pickup at shop'
  ) then 'shop'
  when lower(btrim(fulfillment_type)) in (
    'location', 'pickup_at_location', 'pickup_location', 'location_pickup', 'at_location', 'pickup at location'
  ) then 'location'
  when lower(btrim(fulfillment_type)) in (
    'courier', 'courier_delivery', 'delivery', 'courier delivery'
  ) then 'courier'
  else fulfillment_type
end
where fulfillment_type is null
   or btrim(fulfillment_type) = ''
   or lower(btrim(fulfillment_type)) not in (
     'not_selected','shop','location','courier'
   );

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_fulfillment_type_check'
  ) then
    alter table public.orders drop constraint orders_fulfillment_type_check;
  end if;
end $$;

alter table public.orders
  add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('not_selected','shop','location','courier'));

create or replace function public.set_customer_fulfillment(
  p_public_token text,
  p_fulfillment_type text,
  p_event_id uuid default null
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
  v_event public.events%rowtype;
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_items_total integer := 0;
  v_items_complete integer := 0;
  v_next_fulfillment text;
  v_next_pickup_status text;
begin
  if nullif(trim(p_public_token), '') is null then
    raise exception 'Tracking token is required.';
  end if;

  if p_fulfillment_type not in ('shop','location','courier') then
    raise exception 'Invalid fulfillment type.';
  end if;

  select * into v_qr
  from public.qr_codes
  where public_token = p_public_token
  limit 1;

  if not found or v_qr.order_item_id is null then
    raise exception 'Tracking link not found.';
  end if;

  select * into v_item
  from public.order_items
  where id = v_qr.order_item_id
    and cancelled_at is null
  limit 1;

  if not found then
    raise exception 'Order item not found.';
  end if;

  select * into v_order
  from public.orders
  where id = v_item.order_id
    and cancelled_at is null
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  select coalesce(sum(oi.total_price),0)::numeric(12,2), count(*)::integer
    into v_total, v_items_total
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.cancelled_at is null;

  select count(*)::integer into v_items_complete
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.cancelled_at is null
    and (
      jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb)) = 0
      or (
        select count(*)
        from jsonb_array_elements(coalesce(oi.workflow_snapshot,'[]'::jsonb)) st
        where exists (
          select 1
          from public.stage_logs sl
          where sl.order_item_id = oi.id
            and sl.stage_order = (st->>'stage_order')::integer
            and sl.action = 'finished'
            and not exists (
              select 1
              from public.stage_logs newer
              where newer.order_item_id = oi.id
                and newer.stage_order = sl.stage_order
                and newer.action = 'sent_back'
                and newer.occurred_at > sl.occurred_at
            )
        )
      ) = jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb))
    );

  select coalesce(sum(p.amount),0)::numeric(12,2)
    into v_paid
  from public.payments p
  where p.order_id = v_order.id
    and (p.proof_status is null or p.proof_status = 'confirmed');

  if v_items_total = 0 then
    raise exception 'There are no active items in this order.';
  end if;

  if v_items_complete <> v_items_total then
    raise exception 'Production must be completed before choosing fulfillment.';
  end if;

  if v_paid < v_total then
    raise exception 'Payment must be fully confirmed before choosing fulfillment.';
  end if;

  if p_fulfillment_type = 'location' then
    select * into v_event
    from public.events
    where id = p_event_id
      and seller_id = v_order.seller_id
      and lower(status) in ('upcoming','ready','active')
      and event_date >= current_date
    limit 1;

    if not found then
      raise exception 'Selected pickup event is not available.';
    end if;

    v_next_fulfillment := 'location';
    v_next_pickup_status := 'scheduled';
  elsif p_fulfillment_type = 'shop' then
    v_next_fulfillment := 'shop';
    v_next_pickup_status := 'not_scheduled';
    p_event_id := null;
  else
    v_next_fulfillment := 'courier';
    v_next_pickup_status := 'not_scheduled';
    p_event_id := null;
  end if;

  update public.orders
  set fulfillment_type = v_next_fulfillment,
      event_id = p_event_id,
      pickup_status = v_next_pickup_status,
      updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'fulfillment_type', v_next_fulfillment,
    'event_id', p_event_id,
    'pickup_status', v_next_pickup_status
  );
end;
$$;

grant execute on function public.set_customer_fulfillment(text, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
