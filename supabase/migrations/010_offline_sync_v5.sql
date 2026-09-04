begin;

drop function if exists public.sync_offline_order_v5(text,text,text,uuid,text,text,integer,numeric);

create function public.sync_offline_order_v5(
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
  v_sync public.offline_order_syncs%rowtype;
  v_qr public.qr_codes%rowtype;
  v_order_id uuid;
  v_order_number bigint;
  v_result jsonb;
begin
  if v_seller_id is null then
    raise exception 'Authentication required.' using errcode='42501';
  end if;
  if nullif(trim(coalesce(p_client_order_id,'')),'') is null then
    raise exception 'Client order id is required.';
  end if;
  if nullif(trim(coalesce(p_device_id,'')),'') is null then
    raise exception 'Device id is required.';
  end if;
  if nullif(trim(coalesce(p_qr_public_token,'')),'') is null then
    raise exception 'QR code is required.';
  end if;
  if coalesce(p_quantity,0) < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;
  if coalesce(p_downpayment,0) < 0 then
    raise exception 'Downpayment cannot be negative.';
  end if;

  -- Idempotency: retries return the same server order rather than creating a duplicate.
  select * into v_sync
  from public.offline_order_syncs
  where seller_id = v_seller_id
    and client_order_id = p_client_order_id
  limit 1;

  if found and v_sync.order_id is not null then
    select order_number into v_order_number
    from public.orders
    where id = v_sync.order_id
      and seller_id = v_seller_id;
    return jsonb_build_object(
      'order_id', v_sync.order_id,
      'order_number', v_order_number,
      'already_synced', true
    );
  end if;

  -- The device reservation is an offline-time collision guard. It is NOT required
  -- at sync time: by the time we reconnect, the server's QR availability is the
  -- authoritative concurrency check. This also allows a queue to survive a
  -- reservation-release or device-record cleanup without becoming permanently stuck.
  select * into v_qr
  from public.qr_codes
  where seller_id = v_seller_id
    and public_token = p_qr_public_token
  for update;

  if not found then
    raise exception 'This QR code was not found in your shop.';
  end if;

  if lower(coalesce(v_qr.status,'')) <> 'available'
     or v_qr.order_item_id is not null then
    raise exception 'This QR code is no longer available. It may already have been assigned.';
  end if;

  -- Reuse the already-proven online order creation path. Keeping one server-side
  -- implementation for customer/order/item/price/workflow/QR assignment avoids
  -- schema drift between online and offline-created orders.
  v_result := public.create_order_from_qr(
    p_qr_public_token,
    p_customer_id,
    p_customer_name,
    p_customer_phone,
    p_quantity,
    p_downpayment
  );

  v_order_id := (v_result ->> 'order_id')::uuid;
  v_order_number := (select order_number from public.orders where id = v_order_id and seller_id = v_seller_id);

  if v_order_id is null then
    raise exception 'The server did not return an order id.';
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
    'order_item_id', v_result ->> 'order_item_id',
    'qr_code_id', v_result ->> 'qr_code_id',
    'product_id', v_result ->> 'product_id',
    'already_synced', false
  );
end;
$$;

grant execute on function public.sync_offline_order_v5(text,text,text,uuid,text,text,integer,numeric)
to authenticated;

notify pgrst, 'reload schema';
commit;
