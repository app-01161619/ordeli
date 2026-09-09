-- Seller cancellation controls for whole orders and individual order items.
-- Historical rows are retained; only cancellation timestamps/reasons are written.

create or replace function public.seller_cancel_order_item(
  p_order_item_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_user is null then raise exception 'Authentication required.'; end if;

  select * into v_item
  from public.order_items
  where id = p_order_item_id and seller_id = v_user
  for update;
  if not found then raise exception 'Order item not found.'; end if;

  select * into v_order
  from public.orders
  where id = v_item.order_id and seller_id = v_user
  for update;
  if not found then raise exception 'Order not found.'; end if;

  if v_order.cancelled_at is not null then raise exception 'The order is already cancelled.'; end if;
  if v_order.handed_over_at is not null then raise exception 'A handed-over order cannot be cancelled.'; end if;
  if v_item.cancelled_at is not null then raise exception 'This item is already cancelled.'; end if;

  update public.order_items
  set cancelled_at = now(),
      cancel_reason = coalesce(v_reason, 'Seller cancelled') ,
      updated_at = now()
  where id = v_item.id;

  if not exists (
    select 1 from public.order_items
    where order_id = v_item.order_id and seller_id = v_user and cancelled_at is null
  ) then
    update public.orders
    set cancelled_at = now(),
        cancel_reason = coalesce(v_reason, 'Seller cancelled'),
        pickup_status = 'not_scheduled',
        event_id = null,
        updated_at = now()
    where id = v_order.id;
  end if;

  return jsonb_build_object('cancelled', true, 'order_id', v_order.id, 'order_item_id', v_item.id);
end;
$$;

create or replace function public.seller_cancel_order(
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_user is null then raise exception 'Authentication required.'; end if;

  select * into v_order
  from public.orders
  where id = p_order_id and seller_id = v_user
  for update;
  if not found then raise exception 'Order not found.'; end if;

  if v_order.cancelled_at is not null then raise exception 'The order is already cancelled.'; end if;
  if v_order.handed_over_at is not null then raise exception 'A handed-over order cannot be cancelled.'; end if;

  update public.order_items
  set cancelled_at = now(),
      cancel_reason = coalesce(v_reason, 'Seller cancelled'),
      updated_at = now()
  where order_id = v_order.id and seller_id = v_user and cancelled_at is null;

  update public.orders
  set cancelled_at = now(),
      cancel_reason = coalesce(v_reason, 'Seller cancelled'),
      fulfillment_type = 'not_selected',
      pickup_status = 'not_scheduled',
      event_id = null,
      updated_at = now()
  where id = v_order.id and seller_id = v_user;

  return jsonb_build_object('cancelled', true, 'order_id', v_order.id);
end;
$$;

revoke all on function public.seller_cancel_order_item(uuid, text) from public;
revoke all on function public.seller_cancel_order_item(uuid, text) from anon;
revoke all on function public.seller_cancel_order_item(uuid, text) from authenticated;
grant execute on function public.seller_cancel_order_item(uuid, text) to authenticated;

revoke all on function public.seller_cancel_order(uuid, text) from public;
revoke all on function public.seller_cancel_order(uuid, text) from anon;
revoke all on function public.seller_cancel_order(uuid, text) from authenticated;
grant execute on function public.seller_cancel_order(uuid, text) to authenticated;
