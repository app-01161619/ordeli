begin;

create or replace function public.get_customer_fulfillment(p_public_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_shop_name text;
  v_shop_address text;
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_production_complete boolean := true;
  v_current_event jsonb := null;
  v_events jsonb := '[]'::jsonb;
  v_items_total integer := 0;
  v_items_complete integer := 0;
begin
  if nullif(trim(coalesce(p_public_token,'')),'') is null then
    raise exception 'Tracking token is required.';
  end if;

  select q.*, oi.order_id
    into v_qr, v_item
  from public.qr_codes q
  join public.order_items oi on oi.id = q.order_item_id
  where q.public_token = p_public_token
    and q.status = 'assigned'
  limit 1;

  if not found then
    raise exception 'This tracking link is unavailable.';
  end if;

  select * into v_order
  from public.orders
  where id = v_item.order_id;

  if not found then
    raise exception 'This order is unavailable.';
  end if;

  select shop_name, shop_address into v_shop_name, v_shop_address
  from public.sellers where id = v_order.seller_id;

  select coalesce(sum(oi.total_price),0)::numeric(12,2),
         count(*)::integer
    into v_total, v_items_total
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.cancelled_at is null;

  select coalesce(sum(p.amount),0)::numeric(12,2)
    into v_paid
  from public.payments p
  where p.order_id = v_order.id
    and (p.proof_status is null or p.proof_status = 'confirmed');

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
          select 1 from public.stage_logs sl
          where sl.order_item_id = oi.id
            and sl.stage_order = (st->>'stage_order')::integer
            and sl.action = 'finished'
            and not exists (
              select 1 from public.stage_logs newer
              where newer.order_item_id = oi.id
                and newer.stage_order = sl.stage_order
                and newer.action = 'sent_back'
                and newer.occurred_at > sl.occurred_at
            )
        )
      ) = jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb))
    );

  v_production_complete := (v_items_total = v_items_complete);

  if v_order.event_id is not null then
    select jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'location', e.location,
      'event_date', e.event_date,
      'start_time', e.start_time,
      'end_time', e.end_time,
      'status', e.status
    ) into v_current_event
    from public.events e
    where e.id = v_order.event_id and e.seller_id = v_order.seller_id;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'location', e.location,
      'event_date', e.event_date,
      'start_time', e.start_time,
      'end_time', e.end_time,
      'notes', e.notes
    ) order by e.event_date, e.start_time nulls last, e.name
  ), '[]'::jsonb)
  into v_events
  from public.events e
  where e.seller_id = v_order.seller_id
    and lower(e.status) in ('upcoming','ready','active')
    and e.event_date >= current_date;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', (select c.name from public.customers c where c.id = v_order.customer_id),
    'shop', jsonb_build_object('name', v_shop_name, 'address', v_shop_address),
    'production_completed', v_production_complete,
    'payment_total', v_total,
    'payment_paid', v_paid,
    'payment_remaining', greatest(v_total - v_paid, 0),
    'fully_paid', v_paid >= v_total,
    'fulfillment_type', v_order.fulfillment_type,
    'pickup_status', v_order.pickup_status,
    'handed_over_at', v_order.handed_over_at,
    'event', v_current_event,
    'events', v_events
  );
end;
$$;

grant execute on function public.get_customer_fulfillment(text) to anon, authenticated;

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
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_items_total integer := 0;
  v_items_complete integer := 0;
  v_old_event uuid;
  v_pickup_status text;
begin
  if p_fulfillment_type not in ('shop','location','courier') then
    raise exception 'Invalid fulfillment option.';
  end if;

  select q.*, oi.order_id into v_qr, v_item
  from public.qr_codes q
  join public.order_items oi on oi.id = q.order_item_id
  where q.public_token = p_public_token and q.status = 'assigned'
  limit 1;

  if not found then raise exception 'This tracking link is unavailable.'; end if;

  select * into v_order from public.orders where id = v_item.order_id;
  if not found then raise exception 'This order is unavailable.'; end if;
  if v_order.cancelled_at is not null then raise exception 'This order has been cancelled.'; end if;
  if v_order.handed_over_at is not null then raise exception 'This order has already been handed over.'; end if;

  select coalesce(sum(oi.total_price),0)::numeric(12,2), count(*)::integer
    into v_total, v_items_total
  from public.order_items oi
  where oi.order_id = v_order.id and oi.cancelled_at is null;

  select coalesce(sum(p.amount),0)::numeric(12,2) into v_paid
  from public.payments p
  where p.order_id = v_order.id and (p.proof_status is null or p.proof_status = 'confirmed');

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
          select 1 from public.stage_logs sl
          where sl.order_item_id = oi.id
            and sl.stage_order = (st->>'stage_order')::integer
            and sl.action = 'finished'
            and not exists (
              select 1 from public.stage_logs newer
              where newer.order_item_id = oi.id
                and newer.stage_order = sl.stage_order
                and newer.action = 'sent_back'
                and newer.occurred_at > sl.occurred_at
            )
        )
      ) = jsonb_array_length(coalesce(oi.workflow_snapshot,'[]'::jsonb))
    );

  if v_items_total <> v_items_complete then
    raise exception 'Fulfillment options become available when production is completed.';
  end if;
  if v_paid < v_total then
    raise exception 'Fulfillment options become available after payment is fully confirmed.';
  end if;

  v_old_event := v_order.event_id;

  if p_fulfillment_type = 'location' then
    if p_event_id is null then raise exception 'Choose a pickup event.'; end if;
    if not exists (
      select 1 from public.events e
      where e.id = p_event_id
        and e.seller_id = v_order.seller_id
        and lower(e.status) in ('upcoming','ready','active')
        and e.event_date >= current_date
    ) then
      raise exception 'That pickup event is no longer available.';
    end if;
    v_pickup_status := 'scheduled';
  else
    p_event_id := null;
    v_pickup_status := 'not_scheduled';
  end if;

  update public.orders
  set fulfillment_type = p_fulfillment_type,
      event_id = p_event_id,
      pickup_status = v_pickup_status,
      updated_at = now()
  where id = v_order.id;

  if v_old_event is distinct from p_event_id then
    insert into public.order_event_history(order_id, old_event_id, new_event_id, reason, occurred_at)
    values (v_order.id, v_old_event, p_event_id, 'Customer fulfillment selection', now());
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'fulfillment_type', p_fulfillment_type,
    'event_id', p_event_id,
    'pickup_status', v_pickup_status
  );
end;
$$;

grant execute on function public.set_customer_fulfillment(text,text,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
