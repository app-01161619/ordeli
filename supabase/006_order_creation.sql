-- ============================================================
-- 006_order_creation.sql
-- Ordeli Step 6: QR-first Customer / Order Creation
--
-- The master schema already created:
-- customers, orders, order_items, qr_codes, payments.
--
-- This migration adds only the atomic RPCs required by the seller app.
-- ============================================================

create or replace function public.create_order_from_qr(
  p_qr_public_token text,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_quantity integer default 1,
  p_downpayment numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_qr public.qr_codes%rowtype;
  v_product public.products%rowtype;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_total numeric(12,2);
  v_snapshot jsonb;
begin

  if v_seller_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;

  if p_downpayment is null or p_downpayment < 0 then
    raise exception 'Downpayment cannot be negative.';
  end if;

  select *
  into v_qr
  from public.qr_codes
  where seller_id = v_seller_id
    and public_token = p_qr_public_token
  for update;

  if not found then
    raise exception 'QR code not found in this shop.';
  end if;

  if v_qr.status <> 'available' then
    raise exception 'This QR code is no longer available for a new order.';
  end if;

  select *
  into v_product
  from public.products
  where id = v_qr.product_id
    and seller_id = v_seller_id
    and is_active = true;

  if not found then
    raise exception 'The QR product is no longer active.';
  end if;

  if p_customer_id is not null then

    select c.id
    into v_customer_id
    from public.customers c
    where c.id = p_customer_id
      and c.seller_id = v_seller_id
      and exists (
        select 1
        from public.orders o
        where o.customer_id = c.id
          and o.seller_id = v_seller_id
          and o.cancelled_at is null
      )
    limit 1;

    if v_customer_id is null then
      raise exception 'Selected customer is not an active customer.';
    end if;

  else

    if p_customer_name is null
       or length(trim(p_customer_name)) = 0 then
      raise exception 'Customer name is required.';
    end if;

    insert into public.customers (
      seller_id,
      name,
      phone
    )
    values (
      v_seller_id,
      trim(p_customer_name),
      nullif(trim(coalesce(p_customer_phone, '')), '')
    )
    returning id
    into v_customer_id;

  end if;

  v_total :=
    round(
      v_product.default_price * p_quantity,
      2
    );

  if p_downpayment > v_total then
    raise exception 'Downpayment cannot exceed the order total.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'stage_order', ps.stage_order,
        'name', ps.name
      )
      order by ps.stage_order
    ),
    '[]'::jsonb
  )
  into v_snapshot
  from public.production_stages ps
  where ps.product_id = v_product.id;

  insert into public.orders (
    seller_id,
    customer_id,
    fulfillment_type,
    pickup_status
  )
  values (
    v_seller_id,
    v_customer_id,
    'not_selected',
    'not_scheduled'
  )
  returning id
  into v_order_id;

  insert into public.order_items (
    order_id,
    seller_id,
    product_id,
    qr_code_id,
    product_name,
    quantity,
    unit_price,
    total_price,
    workflow_snapshot,
    cancellable_until_stage
  )
  values (
    v_order_id,
    v_seller_id,
    v_product.id,
    v_qr.id,
    v_product.name,
    p_quantity,
    v_product.default_price,
    v_total,
    v_snapshot,
    v_product.customer_cancellable_until_stage
  )
  returning id
  into v_order_item_id;

  update public.qr_codes
  set
    status = 'assigned',
    order_item_id = v_order_item_id,
    assigned_at = now()
  where id = v_qr.id
    and seller_id = v_seller_id
    and status = 'available';

  if not found then
    raise exception 'QR code was claimed by another operation.';
  end if;

  if p_downpayment > 0 then

    insert into public.payments (
      order_id,
      seller_id,
      amount,
      payment_type,
      proof_status
    )
    values (
      v_order_id,
      v_seller_id,
      p_downpayment,
      'downpayment',
      null
    );

  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_item_id', v_order_item_id,
    'customer_id', v_customer_id,
    'qr_code_id', v_qr.id,
    'product_id', v_product.id,
    'total', v_total,
    'downpayment', p_downpayment,
    'remaining_balance', round(v_total - p_downpayment, 2)
  );

end;
$$;


grant execute
on function public.create_order_from_qr(
  text,
  uuid,
  text,
  text,
  integer,
  numeric
)
to authenticated;


-- ============================================================
-- Add another product item to an existing order.
-- ============================================================

create or replace function public.add_order_item_from_qr(
  p_order_id uuid,
  p_qr_public_token text,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_order_customer_id uuid;
  v_qr public.qr_codes%rowtype;
  v_product public.products%rowtype;
  v_order_item_id uuid;
  v_total numeric(12,2);
  v_snapshot jsonb;
begin

  if v_seller_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;

  select customer_id
  into v_order_customer_id
  from public.orders
  where id = p_order_id
    and seller_id = v_seller_id
    and cancelled_at is null;

  if v_order_customer_id is null then
    raise exception 'Order not found or unavailable.';
  end if;

  select *
  into v_qr
  from public.qr_codes
  where seller_id = v_seller_id
    and public_token = p_qr_public_token
  for update;

  if not found then
    raise exception 'QR code not found in this shop.';
  end if;

  if v_qr.status <> 'available' then
    raise exception 'This QR code is already assigned or unavailable.';
  end if;

  select *
  into v_product
  from public.products
  where id = v_qr.product_id
    and seller_id = v_seller_id
    and is_active = true;

  if not found then
    raise exception 'The QR product is no longer active.';
  end if;

  v_total :=
    round(
      v_product.default_price * p_quantity,
      2
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'stage_order', ps.stage_order,
        'name', ps.name
      )
      order by ps.stage_order
    ),
    '[]'::jsonb
  )
  into v_snapshot
  from public.production_stages ps
  where ps.product_id = v_product.id;

  insert into public.order_items (
    order_id,
    seller_id,
    product_id,
    qr_code_id,
    product_name,
    quantity,
    unit_price,
    total_price,
    workflow_snapshot,
    cancellable_until_stage
  )
  values (
    p_order_id,
    v_seller_id,
    v_product.id,
    v_qr.id,
    v_product.name,
    p_quantity,
    v_product.default_price,
    v_total,
    v_snapshot,
    v_product.customer_cancellable_until_stage
  )
  returning id
  into v_order_item_id;

  update public.qr_codes
  set
    status = 'assigned',
    order_item_id = v_order_item_id,
    assigned_at = now()
  where id = v_qr.id
    and seller_id = v_seller_id
    and status = 'available';

  if not found then
    raise exception 'QR code was claimed by another operation.';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_item_id', v_order_item_id,
    'customer_id', v_order_customer_id,
    'qr_code_id', v_qr.id,
    'product_id', v_product.id,
    'total', v_total
  );

end;
$$;


grant execute
on function public.add_order_item_from_qr(
  uuid,
  text,
  integer
)
to authenticated;
