-- ============================================================
-- 011_offline_order_sync.sql
-- Step 10C: securely synchronize locally saved offline orders.
-- Orders are created on the server only when connectivity returns.
-- ============================================================

create table if not exists public.offline_order_syncs (
  seller_id uuid not null references public.sellers(id) on delete cascade,
  device_id text not null,
  client_order_id text not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  synced_at timestamptz not null default now(),
  primary key (seller_id, client_order_id)
);

create index if not exists offline_order_syncs_device_idx
  on public.offline_order_syncs(seller_id, device_id);

alter table public.offline_order_syncs enable row level security;

drop policy if exists offline_order_syncs_owner on public.offline_order_syncs;
create policy offline_order_syncs_owner on public.offline_order_syncs
  for select to authenticated using (seller_id = auth.uid());

create or replace function public.sync_offline_order(
  p_client_order_id text,
  p_device_id text,
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
  v_existing public.offline_order_syncs%rowtype;
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

  if p_client_order_id is null or length(trim(p_client_order_id)) < 8 then
    raise exception 'Offline client order identifier is required.';
  end if;

  if p_device_id is null or length(trim(p_device_id)) < 8 then
    raise exception 'Device identifier is required.';
  end if;

  -- Serialize retries for the same client order so a timeout cannot create duplicates.
  perform pg_advisory_xact_lock(hashtext(v_seller_id::text || ':' || trim(p_client_order_id))::bigint);

  select * into v_existing
  from public.offline_order_syncs
  where seller_id = v_seller_id
    and client_order_id = trim(p_client_order_id);

  if found then
    return jsonb_build_object(
      'order_id', v_existing.order_id,
      'already_synced', true,
      'client_order_id', v_existing.client_order_id,
      'synced_at', v_existing.synced_at
    );
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;

  if p_downpayment is null or p_downpayment < 0 then
    raise exception 'Downpayment cannot be negative.';
  end if;

  select * into v_qr
  from public.qr_codes
  where seller_id = v_seller_id
    and public_token = trim(p_qr_public_token)
  for update;

  if not found then
    raise exception 'QR code not found in this shop.';
  end if;

  if v_qr.status <> 'available' then
    raise exception 'This QR code is no longer available for a new order.';
  end if;

  -- Offline orders may only consume a QR explicitly reserved to this device.
  if not exists (
    select 1
    from public.offline_qr_reservations r
    where r.qr_code_id = v_qr.id
      and r.seller_id = v_seller_id
      and r.device_id = trim(p_device_id)
  ) then
    raise exception 'This QR code is not reserved for this seller device.';
  end if;

  select * into v_product
  from public.products
  where id = v_qr.product_id
    and seller_id = v_seller_id
    and is_active = true;

  if not found then
    raise exception 'The QR product is no longer active.';
  end if;

  if p_customer_id is not null then
    select c.id into v_customer_id
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
    if p_customer_name is null or length(trim(p_customer_name)) = 0 then
      raise exception 'Customer name is required.';
    end if;

    insert into public.customers(seller_id, name, phone)
    values (
      v_seller_id,
      trim(p_customer_name),
      nullif(trim(coalesce(p_customer_phone, '')), '')
    )
    returning id into v_customer_id;
  end if;

  v_total := round(v_product.default_price * p_quantity, 2);

  if p_downpayment > v_total then
    raise exception 'Downpayment cannot exceed the order total.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'stage_order', ps.stage_order,
        'name', ps.name
      ) order by ps.stage_order
    ),
    '[]'::jsonb
  )
  into v_snapshot
  from public.production_stages ps
  where ps.product_id = v_product.id;

  insert into public.orders(
    seller_id,
    customer_id,
    fulfillment_type,
    pickup_status
  )
  values(
    v_seller_id,
    v_customer_id,
    'not_selected',
    'not_scheduled'
  )
  returning id into v_order_id;

  insert into public.order_items(
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
  values(
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
  returning id into v_order_item_id;

  update public.qr_codes
  set status = 'assigned',
      order_item_id = v_order_item_id,
      assigned_at = now()
  where id = v_qr.id
    and seller_id = v_seller_id
    and status = 'available';

  if not found then
    raise exception 'QR code was claimed by another operation.';
  end if;

  delete from public.offline_qr_reservations
  where qr_code_id = v_qr.id
    and seller_id = v_seller_id
    and device_id = trim(p_device_id);

  if p_downpayment > 0 then
    insert into public.payments(
      order_id,
      seller_id,
      amount,
      payment_type,
      proof_status
    )
    values(
      v_order_id,
      v_seller_id,
      p_downpayment,
      'downpayment',
      null
    );
  end if;

  insert into public.offline_order_syncs(
    seller_id,
    device_id,
    client_order_id,
    order_id
  )
  values(
    v_seller_id,
    trim(p_device_id),
    trim(p_client_order_id),
    v_order_id
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_item_id', v_order_item_id,
    'customer_id', v_customer_id,
    'qr_code_id', v_qr.id,
    'product_id', v_product.id,
    'total', v_total,
    'downpayment', p_downpayment,
    'remaining_balance', round(v_total - p_downpayment, 2),
    'already_synced', false,
    'client_order_id', trim(p_client_order_id)
  );
end;
$$;

revoke all on function public.sync_offline_order(text,text,text,uuid,text,text,integer,numeric) from public;
grant execute on function public.sync_offline_order(text,text,text,uuid,text,text,integer,numeric) to authenticated;
