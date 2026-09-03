-- ============================================================
-- 010_offline_qr_reservation.sql
-- Step 10B: reserve QR inventory to a specific seller device.
-- ============================================================


-- Prevent legacy order RPC signatures from bypassing reservation ownership.
drop function if exists public.create_order_from_qr(text, uuid, text, text, integer, numeric);
drop function if exists public.add_order_item_from_qr(uuid, text, integer);

create table if not exists public.offline_qr_reservations (
  qr_code_id uuid primary key references public.qr_codes(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  device_id text not null,
  reserved_at timestamptz not null default now()
);

create index if not exists offline_qr_reservations_seller_idx on public.offline_qr_reservations(seller_id);
create index if not exists offline_qr_reservations_device_idx on public.offline_qr_reservations(device_id);

alter table public.offline_qr_reservations enable row level security;
drop policy if exists offline_qr_reservations_owner on public.offline_qr_reservations;
create policy offline_qr_reservations_owner on public.offline_qr_reservations
  for select to authenticated using (seller_id = auth.uid());

create or replace function public.reserve_qr_codes_for_offline(
  p_product_id uuid,
  p_series_name text,
  p_quantity integer,
  p_device_id text
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_seller_id uuid := auth.uid();
  v_count integer;
begin
  if v_seller_id is null then raise exception 'Authentication required.'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 5000 then raise exception 'Quantity must be between 1 and 5000.'; end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then raise exception 'Device identifier is required.'; end if;
  if p_product_id is null or p_series_name is null or length(trim(p_series_name)) = 0 then raise exception 'Product and series are required.'; end if;

  with candidates as (
    select q.id
    from public.qr_codes q
    where q.seller_id = v_seller_id
      and q.product_id = p_product_id
      and q.series_name = trim(p_series_name)
      and q.status = 'available'
      and not exists (select 1 from public.offline_qr_reservations r where r.qr_code_id = q.id)
    order by q.series_sequence
    limit p_quantity
    for update skip locked
  )
  insert into public.offline_qr_reservations(qr_code_id, seller_id, device_id)
  select id, v_seller_id, trim(p_device_id) from candidates
  on conflict (qr_code_id) do nothing;

  get diagnostics v_count = row_count;
  if v_count < p_quantity then raise exception 'Only % unreserved QR pair(s) are available in this series.', v_count; end if;
  return v_count;
end;
$$;

create or replace function public.release_qr_reservations_for_offline(
  p_product_id uuid,
  p_series_name text,
  p_device_id text
) returns integer
language plpgsql security definer set search_path=public as $$
declare v_seller_id uuid := auth.uid(); v_count integer;
begin
  if v_seller_id is null then raise exception 'Authentication required.'; end if;
  delete from public.offline_qr_reservations r
  using public.qr_codes q
  where r.qr_code_id = q.id and r.seller_id = v_seller_id and r.device_id = trim(p_device_id)
    and q.product_id = p_product_id and q.series_name = trim(p_series_name);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reserve_qr_codes_for_offline(uuid,text,integer,text) from public;
grant execute on function public.reserve_qr_codes_for_offline(uuid,text,integer,text) to authenticated;
revoke all on function public.release_qr_reservations_for_offline(uuid,text,text) from public;
grant execute on function public.release_qr_reservations_for_offline(uuid,text,text) to authenticated;

create or replace function public.create_order_from_qr(
  p_qr_public_token text,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_quantity integer default 1,
  p_downpayment numeric default 0,
  p_device_id text default null
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

  if v_qr.status not in ('available') then
    raise exception 'This QR code is no longer available for a new order.';
  end if;

  if exists (select 1 from public.offline_qr_reservations r where r.qr_code_id = v_qr.id and r.device_id <> coalesce(p_device_id, '')) then
    raise exception 'This QR code is reserved for another seller device.';
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

  delete from public.offline_qr_reservations where qr_code_id = v_qr.id;

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





-- ============================================================


grant execute on function public.create_order_from_qr(text, uuid, text, text, integer, numeric, text) to authenticated;

-- Add another product item to an existing order.
-- ============================================================

create or replace function public.add_order_item_from_qr(
  p_order_id uuid,
  p_qr_public_token text,
  p_quantity integer default 1,
  p_device_id text default null
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

  if exists (select 1 from public.offline_qr_reservations r where r.qr_code_id = v_qr.id and r.device_id <> coalesce(p_device_id, '')) then
    raise exception 'This QR code is reserved for another seller device.';
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

  delete from public.offline_qr_reservations where qr_code_id = v_qr.id;

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





grant execute on function public.add_order_item_from_qr(uuid, text, integer, text) to authenticated;
