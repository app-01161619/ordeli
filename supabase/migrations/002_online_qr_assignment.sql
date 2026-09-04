-- Ordeli: online QR assignment for adding an item to an existing order.
-- QR reservations prevent offline devices from colliding. They do NOT block
-- legitimate ONLINE assignments by the same seller.

begin;

create or replace function public.add_order_item_online(
  p_order_id uuid,
  p_qr_public_token text,
  p_quantity integer,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_qr public.qr_codes%rowtype;
  v_product public.products%rowtype;
  v_item_id uuid;
  v_total numeric;
  v_workflow jsonb;
begin
  if v_seller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_order_id is null then raise exception 'Order is required.'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Quantity must be at least 1.'; end if;

  select * into v_order
  from public.orders
  where id = p_order_id and seller_id = v_seller_id
  for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.cancelled_at is not null then raise exception 'This order has been cancelled.'; end if;

  select * into v_qr
  from public.qr_codes
  where seller_id = v_seller_id and public_token = p_qr_public_token
  for update;
  if not found then raise exception 'This QR code was not found in your shop.'; end if;
  if lower(coalesce(v_qr.status, '')) <> 'available' or v_qr.order_item_id is not null then
    raise exception 'This QR code is not currently available.';
  end if;

  select * into v_product
  from public.products
  where id = v_qr.product_id and seller_id = v_seller_id;
  if not found then raise exception 'The product for this QR code could not be found.'; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('stage_order', ps.stage_order, 'name', ps.name)
      order by ps.stage_order
    ), '[]'::jsonb
  ) into v_workflow
  from public.production_stages ps
  where ps.product_id = v_product.id;

  v_total := coalesce(v_product.default_price, 0) * p_quantity;

  insert into public.order_items (
    order_id, seller_id, product_id, qr_code_id, product_name,
    quantity, unit_price, total_price, workflow_snapshot,
    cancellable_until_stage, created_at, updated_at
  ) values (
    v_order.id, v_seller_id, v_product.id, v_qr.id, v_product.name,
    p_quantity, coalesce(v_product.default_price, 0), v_total, v_workflow,
    v_product.customer_cancellable_until_stage, now(), now()
  ) returning id into v_item_id;

  update public.qr_codes
  set status = 'assigned', order_item_id = v_item_id, assigned_at = coalesce(assigned_at, now())
  where id = v_qr.id;

  update public.orders set updated_at = now() where id = v_order.id;

  return jsonb_build_object(
    'order_item_id', v_item_id,
    'order_id', v_order.id,
    'qr_code_id', v_qr.id,
    'product_id', v_product.id
  );
end;
$$;

grant execute on function public.add_order_item_online(uuid, text, integer, text) to authenticated;

commit;
