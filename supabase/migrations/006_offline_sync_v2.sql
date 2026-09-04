-- Ordeli: canonical v2 offline order sync RPC. New name avoids stale RPC/schema-cache collisions.
-- to reload its function schema. Safe to run after 004.

begin;

create or replace function public.sync_offline_order_v2(
  p_client_order_id text,
  p_device_id text,
  p_qr_public_token text,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_quantity integer default null,
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
  v_customer_name text;
  v_customer_phone text;
  v_order_id uuid;
  v_item_id uuid;
  v_order_number bigint;
  v_workflow jsonb;
  v_total numeric;
  v_downpayment numeric := greatest(coalesce(p_downpayment, 0), 0);
begin
  if v_seller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_client_order_id, '')), '') is null then
    raise exception 'Client order id is required.';
  end if;
  if nullif(trim(coalesce(p_device_id, '')), '') is null then
    raise exception 'Device id is required.';
  end if;
  if nullif(trim(coalesce(p_qr_public_token, '')), '') is null then
    raise exception 'QR code is required.';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;

  select * into v_existing
  from public.offline_order_syncs
  where seller_id = v_seller_id
    and client_order_id = p_client_order_id;

  if found and v_existing.order_id is not null then
    select order_number into v_order_number
    from public.orders where id = v_existing.order_id and seller_id = v_seller_id;
    return jsonb_build_object(
      'order_id', v_existing.order_id,
      'order_number', v_order_number,
      'already_synced', true
    );
  end if;

  select * into v_qr
  from public.qr_codes
  where seller_id = v_seller_id
    and public_token = p_qr_public_token
  for update;

  if not found then
    raise exception 'This QR code was not found in your shop.';
  end if;

  if v_qr.order_item_id is not null or lower(coalesce(v_qr.status, '')) <> 'available' then
    raise exception 'This QR code is no longer available.';
  end if;

  if not exists (
    select 1
    from public.offline_qr_reservations r
    where r.qr_code_id = v_qr.id
      and r.seller_id = v_seller_id
      and r.device_id = p_device_id
  ) then
    raise exception 'This QR code was not reserved for this seller device.';
  end if;

  select * into v_product
  from public.products
  where id = v_qr.product_id
    and seller_id = v_seller_id
    and is_active = true;
  if not found then
    raise exception 'The product for this QR code could not be found.';
  end if;

  if p_customer_id is not null then
    select c.id, c.name, c.phone
      into v_customer_id, v_customer_name, v_customer_phone
    from public.customers c
    where c.id = p_customer_id
      and c.seller_id = v_seller_id;
    if not found then
      raise exception 'The selected customer was not found.';
    end if;
  else
    v_customer_name := nullif(trim(coalesce(p_customer_name, '')), '');
    v_customer_phone := nullif(trim(coalesce(p_customer_phone, '')), '');
    if v_customer_name is null then
      raise exception 'Customer name is required.';
    end if;

    insert into public.customers (seller_id, name, phone, created_at, updated_at)
    values (v_seller_id, v_customer_name, v_customer_phone, now(), now())
    returning id into v_customer_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('stage_order', ps.stage_order, 'name', ps.name)
      order by ps.stage_order
    ), '[]'::jsonb
  )
  into v_workflow
  from public.production_stages ps
  where ps.product_id = v_product.id;

  v_total := coalesce(v_product.default_price, 0) * p_quantity;
  if v_downpayment > v_total then
    raise exception 'Downpayment cannot exceed the order total.';
  end if;

  insert into public.orders (
    seller_id, customer_id, fulfillment_type, pickup_status, created_at, updated_at
  ) values (
    v_seller_id, v_customer_id, null, 'not_scheduled', now(), now()
  )
  returning id, order_number into v_order_id, v_order_number;

  insert into public.order_items (
    order_id, seller_id, product_id, qr_code_id, product_name, quantity,
    unit_price, total_price, workflow_snapshot, cancellable_until_stage,
    created_at, updated_at
  ) values (
    v_order_id, v_seller_id, v_product.id, v_qr.id, v_product.name, p_quantity,
    coalesce(v_product.default_price, 0), v_total, v_workflow,
    v_product.customer_cancellable_until_stage, now(), now()
  )
  returning id into v_item_id;

  update public.qr_codes
  set status = 'assigned', order_item_id = v_item_id, assigned_at = coalesce(assigned_at, now())
  where id = v_qr.id;

  if v_downpayment > 0 then
    insert into public.payments (
      order_id, seller_id, amount, payment_type, proof_status, created_at
    ) values (
      v_order_id, v_seller_id, v_downpayment, 'downpayment', null, now()
    );
  end if;

  insert into public.offline_order_syncs (
    seller_id, device_id, client_order_id, order_id, synced_at
  ) values (
    v_seller_id, p_device_id, p_client_order_id, v_order_id, now()
  )
  on conflict (seller_id, client_order_id) do update
    set device_id = excluded.device_id,
        order_id = excluded.order_id,
        synced_at = excluded.synced_at;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'order_item_id', v_item_id,
    'qr_code_id', v_qr.id,
    'product_id', v_product.id,
    'already_synced', false
  );
end;
$$;

grant execute on function public.sync_offline_order_v2(text, text, text, uuid, text, text, integer, numeric)
to authenticated;

-- PostgREST caches function signatures. Explicitly request a schema refresh.
notify pgrst, 'reload schema';

commit;
