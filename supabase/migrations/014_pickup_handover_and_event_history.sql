begin;

create or replace function public.update_order_pickup_status(
  p_order_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_user uuid := auth.uid();
  v_total numeric(12,2) := 0;
  v_paid numeric(12,2) := 0;
  v_items_total integer := 0;
  v_items_complete integer := 0;
begin
  if v_user is null then raise exception 'Authentication required.'; end if;
  if p_action not in ('handed_over','unclaimed') then raise exception 'Invalid pickup action.'; end if;

  select * into v_order
  from public.orders
  where id = p_order_id and seller_id = v_user
  for update;

  if not found then raise exception 'Order not found.'; end if;
  if v_order.cancelled_at is not null then raise exception 'This order has been cancelled.'; end if;

  if p_action = 'handed_over' and v_order.handed_over_at is not null then
    return jsonb_build_object(
      'order_id', v_order.id,
      'pickup_status', 'handed_over',
      'handed_over_at', v_order.handed_over_at
    );
  end if;

  select coalesce(sum(oi.total_price),0)::numeric(12,2), count(*)::integer
    into v_total, v_items_total
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.cancelled_at is null;

  if v_items_total = 0 then raise exception 'There are no active items in this order.'; end if;

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

  select coalesce(sum(p.amount),0)::numeric(12,2) into v_paid
  from public.payments p
  where p.order_id = v_order.id
    and (p.proof_status is null or p.proof_status = 'confirmed');

  if p_action = 'handed_over' then
    if v_order.fulfillment_type not in ('shop','location') then
      raise exception 'Only pickup orders can be handed over in the app.';
    end if;
    if v_items_complete <> v_items_total then
      raise exception 'Production must be completed before handover.';
    end if;
    if v_paid < v_total then
      raise exception 'Payment must be fully confirmed before handover.';
    end if;
    if v_order.fulfillment_type = 'location' and v_order.event_id is null then
      raise exception 'This pickup order has no event assigned.';
    end if;

    update public.orders
    set pickup_status = 'handed_over',
        handed_over_at = now(),
        updated_at = now()
    where id = v_order.id;

    return jsonb_build_object(
      'order_id', v_order.id,
      'pickup_status', 'handed_over',
      'handed_over_at', now()
    );
  end if;

  if v_order.fulfillment_type <> 'location' then
    raise exception 'Only pickup-at-location orders can be marked unclaimed.';
  end if;
  if v_order.event_id is null then
    raise exception 'This order has no pickup event.';
  end if;
  if v_order.handed_over_at is not null then
    raise exception 'This order has already been handed over.';
  end if;

  update public.orders
  set pickup_status = 'unclaimed', updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'pickup_status', 'unclaimed'
  );
end;
$$;

grant execute on function public.update_order_pickup_status(uuid, text) to authenticated;

commit;
